import asyncio
import json
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert

from ..database import async_session_maker
from ..database.models.firespot import Firespot
from ..database.models.region import Region
from .firefetch import fetch_live_fires


_REGIONS_PATH = Path(__file__).resolve().parents[1] / "database" / "seedbag" / "regions_info.json"


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
                    detected_at = datetime.strptime(date_str + time_str, fmt).replace(tzinfo=timezone.utc)
                    break
                except ValueError:
                    continue
            if detected_at is None:
                continue
            tumboon = fire.get("TUMBOON", "")
            tumboon_count[tumboon] += 1
            name = f"{tumboon}#{tumboon_count[tumboon]}"
            rows.append(
                {
                    "name": name,
                    "detail": {k: fire[k] for k in ("SATELLITE", "TUMBOON", "AUMPER", "PROVINCE", "TYPE", "NAME", "FOREST", "OWN") if k in fire},
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

async def get_fires(
    region_path: str | None = None,
    status: bool | None = None,
    on_date: date | None = None,
    limit: int = 200,
    user=None,
) -> list[dict]:
    from geoalchemy2.shape import to_shape
    from ..database.models.region import Region
    from .permission import user_region_paths

    async with async_session_maker() as session:
        stmt = select(
            Firespot.id,
            Firespot.external_id,
            Firespot.detected_at,
            Firespot.status,
            Firespot.resolve_time,
            Firespot.location,
            Region.path.label("region_path"),
        ).join(Region, Firespot.region_id == Region.id)

        if region_path is not None:
            stmt = stmt.where(Region.path.op("<@")(region_path))
        if status is not None:
            stmt = stmt.where(Firespot.status == status)
        if on_date is not None:
            stmt = stmt.where(func.date(Firespot.detected_at) == on_date)

        if user is not None and not user.is_superuser:
            paths = await user_region_paths(user, session)
            if not paths:
                return []
            stmt = stmt.where(or_(*[Region.path.op("<@")(p) for p in paths]))

        stmt = stmt.order_by(Firespot.detected_at.desc()).limit(limit)
        rows = await session.execute(stmt)
        rows = rows.all()
        print(f"[get_fires] on_date={on_date} rows={len(rows)}")

        result = []
        for row in rows:
            pt = to_shape(row.location)
            result.append({
                "id": str(row.id),
                "external_id": row.external_id,
                "detected_at": row.detected_at.isoformat(),
                "status": row.status,
                "resolve_time": row.resolve_time.isoformat() if row.resolve_time else None,
                "lat": pt.y,
                "lng": pt.x,
                "path": row.region_path,
            })
        return result