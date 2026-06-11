import asyncio
import json
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import func, or_, select, update
from sqlalchemy.dialects.postgresql import insert

from .. import storage
from ..config import get_settings
from ..database import async_session_maker
from ..database.models.fire_resolution import FireResolutionImage
from ..database.models.field_officer import FieldOfficer
from ..database.models.firespot import Firespot
from ..database.models.region import Region
from .firefetch import fetch_live_fires


_REGIONS_PATH = Path(__file__).resolve().parents[1] / "database" / "seedbag" / "regions_info.json"

# the wildfire feed reports detection times in Thai local time
_INGEST_TZ = ZoneInfo(get_settings().INGEST_TIMEZONE)


def _build_province_path_map() -> dict[str, str]:
    """Map Thai province name → DB ltree path (e.g. 'เชียงใหม่' → 'th.r1.p50')."""
    if not _REGIONS_PATH.exists():
        return {}
    data = json.loads(_REGIONS_PATH.read_text(encoding="utf-8"))
    nat_slug = data["national"]["slug"]
    result: dict[str, str] = {}
    for pv in data.get("province", []):
        name_th = pv.get("name_th", "").strip()
        if name_th:
            result[name_th] = f"{nat_slug}.{pv['parent_slug']}.{pv['slug']}"
    return result


_PROVINCE_PATH: dict[str, str] = _build_province_path_map()


def _path_for(feature: dict) -> str:
    province_th = (feature.get("PROVINCE") or "").strip()
    return _PROVINCE_PATH.get(province_th, "th")

async def _store_fires_to_db(fires: list[dict]) -> None:
    async with async_session_maker() as session:
        result = await session.execute(select(Region.path, Region.id))
        path_to_id = {row.path: row.id for row in result}

        rows: list[dict] = []
        tumboon_count: Counter[str] = Counter()
        for fire in fires:
            region_id = path_to_id.get(fire["path"])
            if region_id is None:
                continue

            lat, lng = fire.get("LAT"), fire.get("LONG")
            if lat is None or lng is None:
                continue
            date_str = str(fire.get("YYMMDD", ""))
            time_str = str(fire.get("TIME", "0000")).zfill(4)
            detected_at = None
            for fmt in ("%Y-%m-%d%H%M", "%y%m%d%H%M"):
                try:
                    detected_at = datetime.strptime(date_str + time_str, fmt).replace(tzinfo=_INGEST_TZ)
                    break
                except ValueError:
                    continue
            if detected_at is None:
                continue
            tumboon = fire.get("TUMBON", "")
            tumboon_count[tumboon] += 1
            name = f"{tumboon} #{tumboon_count[tumboon]}"
            rows.append(
                {
                    "name": name,
                    "detail": {k: fire[k] for k in ("SATELLITE", "TUMBON", "AUMPER", "PROVINCE", "TYPE", "NAME", "FOREST", "OWN") if k in fire},
                    "external_id": f"{fire.get('YYMMDD','')}-{fire.get('TIME','')}-{fire.get('LAT','')}-{fire.get('LONG','')}",
                    "region_id": region_id,
                    "detected_at": detected_at,
                    "location": from_shape(Point(float(lng), float(lat)), srid=4326),
                    "status": False,
                    "resolve_time": None,
                }
            )
        if not rows:
            return
        stmt = (
            insert(Firespot)
            .values(rows)
            .on_conflict_do_nothing(index_elements=["external_id"])
        )
        await session.execute(stmt)
        await session.commit()

async def update_fires() -> None:
    fires = await asyncio.to_thread(fetch_live_fires)
    print(f"[update_fires] fetched={len(fires)}")
    for fire in fires:
        fire["path"] = _path_for(fire)
    await _store_fires_to_db(fires)
    print(f"[update_fires] completed")
    return


async def expire_old_fires() -> None:
    """Mark fires unresolved after FIRE_EXPIRE_DAYS as expired and release their officers."""
    cutoff = datetime.now(_INGEST_TZ) - timedelta(days=get_settings().FIRE_EXPIRE_DAYS)
    async with async_session_maker() as session:
        expired_ids = (
            await session.execute(
                update(Firespot)
                .where(Firespot.status == False, Firespot.detected_at < cutoff)  # noqa: E712
                .values(status=True, expired=True, resolve_time=func.now())
                .returning(Firespot.id)
            )
        ).scalars().all()
        if expired_ids:
            await session.execute(
                update(FieldOfficer)
                .where(FieldOfficer.fire_id.in_(expired_ids))
                .values(fire_id=None)
            )
            print(f"[expire_old_fires] expired={len(expired_ids)}")
        await session.commit()

async def sweep_orphan_images() -> None:
    """Remove evidence objects whose resolve transaction never committed.

    Keys are date-prefixed (resolutions/YYYYMMDD/...), so only yesterday's
    prefix needs scanning: today's uploads may still be in flight, and older
    days were already swept."""
    day = f"{datetime.now(timezone.utc) - timedelta(days=1):%Y%m%d}"
    keys = await storage.list_keys(f"resolutions/{day}/")
    if not keys:
        return
    async with async_session_maker() as session:
        known = (
            await session.execute(
                select(FireResolutionImage.object_key).where(FireResolutionImage.object_key.in_(keys))
            )
        ).scalars().all()
    orphans = sorted(set(keys) - set(known))
    if orphans:
        await storage.remove_objects(orphans)
        print(f"[sweep_orphan_images] removed={len(orphans)}")


async def get_fires(
    region_path: str | None = None,
    status: bool | None = None,
    on_date: date | None = None,
    user=None,
) -> list[dict]:
    from geoalchemy2.shape import to_shape
    from ..database.models.region import Region
    from .permission import user_region_paths

    async with async_session_maker() as session:
        stmt = select(
            Firespot.id,
            Firespot.external_id,
            Firespot.name,
            Firespot.detail,
            Firespot.detected_at,
            Firespot.status,
            Firespot.expired,
            Firespot.resolve_time,
            Firespot.location,
            Region.path.label("region_path"),
            FieldOfficer.id.label("holder_id"),
        ).join(Region, Firespot.region_id == Region.id).outerjoin(
            FieldOfficer, FieldOfficer.fire_id == Firespot.id
        )

        if region_path is not None:
            stmt = stmt.where(Region.path.op("<@")(region_path))
        if status is not None:
            stmt = stmt.where(Firespot.status == status)
        if on_date is not None:
            stmt = stmt.where(func.date(Firespot.detected_at) == on_date)
        else:
            # default view: only fires detected today (Thai time)
            today_start = datetime.now(_INGEST_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
            stmt = stmt.where(Firespot.detected_at >= today_start)

        if user is not None and not user.is_superuser:
            paths = await user_region_paths(user, session)
            if not paths:
                return []
            stmt = stmt.where(or_(*[Region.path.op("<@")(p) for p in paths]))

        stmt = stmt.order_by(Firespot.detected_at.desc())
        rows = await session.execute(stmt)
        rows = rows.all()
        print(f"[get_fires] on_date={on_date} rows={len(rows)}")

        result = []
        for row in rows:
            pt = to_shape(row.location)
            result.append({
                "id": str(row.id),
                "name": row.name,
                "detected_at": row.detected_at.isoformat(),
                "status": row.status,
                "expired": row.expired,
                "booked": row.holder_id is not None,
                "lat": pt.y,
                "lng": pt.x,
                "tumboon": row.detail.get("TUMBON") if hasattr(row, "detail") else None,
                "aumper": row.detail.get("AUMPER") if hasattr(row, "detail") else None,
                "province": row.detail.get("PROVINCE") if hasattr(row, "detail") else None,
                "type": row.detail.get("NAME") if hasattr(row, "detail") else None,

            })
        return result