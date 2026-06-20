import asyncio
import json
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import aliased

from .. import storage
from ..config import get_settings
from ..database import async_session_maker
from ..database.models.fire_resolution import FireResolution, FireResolutionImage
from ..database.models.field_officer import FieldOfficer
from ..database.models.firespot import Firespot
from ..database.models.region import Region
from .audit import audit
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

def number_new_fires(parsed: list[dict], existing_ext: set[str],
                     seed_counts: dict[tuple[str, str], int]) -> list[dict]:
    """Assign '<tumbon> #N' names to fires not already stored, continuing the
    per-(tumbon, day) count from seed_counts (the day's existing total). Already
    stored fires (by external_id) are dropped — they keep their original name."""
    counter: Counter[tuple[str, str]] = Counter(seed_counts)
    out: list[dict] = []
    for p in parsed:
        if p["external_id"] in existing_ext:
            continue
        key = (p["tumboon"], p["day"])
        counter[key] += 1
        out.append({**p, "name": f"{p['tumboon']} #{counter[key]}"})
    return out


async def _store_fires_to_db(fires: list[dict]) -> None:
    async with async_session_maker() as session:
        result = await session.execute(select(Region.path, Region.id))
        path_to_id = {row.path: row.id for row in result}

        # First pass: parse + validate. Names are numbered per (tumbon, day) so the
        # counter continues across the day's ingest runs instead of restarting at #1.
        parsed: list[dict] = []
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
                    # ponytail: feed time is already Thai wall-clock; label it UTC so the
                    # exact numbers survive the timestamptz round-trip and the API returns
                    # the original time. Now-comparisons below use the same convention.
                    detected_at = datetime.strptime(date_str + time_str, fmt).replace(tzinfo=timezone.utc)
                    break
                except ValueError:
                    continue
            if detected_at is None:
                continue
            parsed.append({
                "tumboon": fire.get("TUMBON", "") or "ไม่ทราบตำบล",
                "day": detected_at.date().isoformat(),
                "detected_at": detected_at,
                "region_id": region_id,
                "lat": lat, "lng": lng,
                "detail": {k: fire[k] for k in ("SATELLITE", "TUMBON", "AUMPER", "PROVINCE", "TYPE", "NAME", "FOREST", "OWN") if k in fire},
                "external_id": f"{fire.get('YYMMDD','')}-{fire.get('TIME','')}-{fire.get('LAT','')}-{fire.get('LONG','')}",
            })

        # Skip fires already stored (kept their original name) and seed the per
        # (tumbon, day) counter from how many are already on record for that day, so
        # a new fire is numbered #(n+1) rather than colliding back at #1.
        ext_ids = [p["external_id"] for p in parsed]
        existing_ext = set((await session.execute(
            select(Firespot.external_id).where(Firespot.external_id.in_(ext_ids))
        )).scalars().all()) if ext_ids else set()

        seed_counts: dict[tuple[str, str], int] = {}
        if parsed:
            min_day = min(p["day"] for p in parsed)
            seed = await session.execute(text(
                "SELECT COALESCE(NULLIF(detail->>'TUMBON',''),'ไม่ทราบตำบล') AS tumbon, "
                "(detected_at AT TIME ZONE 'UTC')::date::text AS d, count(*) AS c "
                "FROM firespots WHERE (detected_at AT TIME ZONE 'UTC')::date >= CAST(:min_day AS date) "
                "GROUP BY 1, 2"
            ).bindparams(min_day=min_day))
            seed_counts = {(r.tumbon, r.d): r.c for r in seed}

        rows = [
            {
                "name": p["name"],
                "detail": p["detail"],
                "external_id": p["external_id"],
                "region_id": p["region_id"],
                "detected_at": p["detected_at"],
                "location": from_shape(Point(float(p["lng"]), float(p["lat"])), srid=4326),
                "status": False,
                "resolve_time": None,
            }
            for p in number_new_fires(parsed, existing_ext, seed_counts)
        ]
        inserted = 0
        if rows:
            stmt = (
                insert(Firespot)
                .values(rows)
                .on_conflict_do_nothing(index_elements=["external_id"])
                .returning(Firespot.id)
            )
            inserted = len((await session.execute(stmt)).scalars().all())
        # skipped = duplicates + rows dropped for missing region/coords/date
        by_satellite = dict(Counter(f.get("SATELLITE", "?") for f in fires))
        audit(session, actor=None, action="fire.ingest", entity_type="fire",
              detail={"fetched": len(fires), "inserted": inserted,
                      "skipped": len(fires) - inserted, "by_satellite": by_satellite})
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
    cutoff = datetime.now(_INGEST_TZ).replace(tzinfo=timezone.utc) - timedelta(days=get_settings().FIRE_EXPIRE_DAYS)
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
            audit(session, actor=None, action="fire.expire", entity_type="fire",
                  detail={"count": len(expired_ids)})
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
        # the officer who resolved a fire: resolve clears FieldOfficer.fire_id, so the
        # live holder join goes null — recover the name via the resolution record instead
        # (auto-expired fires have no resolution row, so they stay unattributed)
        ResolverOfficer = aliased(FieldOfficer)
        stmt = select(
            Firespot.id,
            Firespot.external_id,
            Firespot.name,
            Firespot.detail,
            Firespot.detected_at,
            Firespot.status,
            Firespot.expired,
            Firespot.false_alarm,
            Firespot.resolve_time,
            Firespot.location,
            Region.path.label("region_path"),
            FieldOfficer.id.label("holder_id"),
            FieldOfficer.name.label("holder_name"),
            FieldOfficer.appointed.label("holder_appointed"),
            ResolverOfficer.name.label("resolver_name"),
            FireResolution.officer_name.label("resolution_officer_name"),
        ).join(Region, Firespot.region_id == Region.id).outerjoin(
            FieldOfficer, FieldOfficer.fire_id == Firespot.id
        ).outerjoin(
            FireResolution, FireResolution.fire_id == Firespot.id
        ).outerjoin(
            ResolverOfficer, ResolverOfficer.id == FireResolution.officer_id
        )

        if region_path is not None:
            stmt = stmt.where(Region.path.op("<@")(region_path))
        if status is not None:
            stmt = stmt.where(Firespot.status == status)
        if on_date is not None:
            stmt = stmt.where(func.date(Firespot.detected_at) == on_date)
        else:
            # default view: fires detected within the last FIRE_DISPLAY_DAYS (Thai time),
            # inclusive of today (1 = today only)
            days = max(get_settings().FIRE_DISPLAY_DAYS, 1)
            today_start = datetime.now(_INGEST_TZ).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=timezone.utc)
            window_start = today_start - timedelta(days=days - 1)
            stmt = stmt.where(Firespot.detected_at >= window_start)

        if user is not None and not user.is_superuser:
            paths = await user_region_paths(user, session)
            conds = [Region.path.op("<@")(p) for p in paths]
            # a field officer can be appointed a fire OUTSIDE their region — always
            # include the fire they currently hold so it still shows on their map/list
            held = (await session.execute(
                select(FieldOfficer.fire_id).where(
                    FieldOfficer.user_id == user.id, FieldOfficer.fire_id.isnot(None)
                )
            )).scalar_one_or_none()
            if held is not None:
                conds.append(Firespot.id == held)
            if not conds:
                return []
            stmt = stmt.where(or_(*conds))

        stmt = stmt.order_by(Firespot.detected_at.desc())
        rows = await session.execute(stmt)
        rows = rows.all()
        print(f"[get_fires] on_date={on_date} rows={len(rows)}")

        result = []
        for row in rows:
            pt = to_shape(row.location)
            detail = row.detail or {}
            result.append({
                "id": str(row.id),
                "name": row.name,
                "detected_at": row.detected_at.isoformat(),
                "status": row.status,
                "expired": row.expired,
                "false_alarm": row.false_alarm,
                "booked": row.holder_id is not None,
                "appointed": bool(row.holder_appointed),  # dispatcher-assigned vs self-reserved
                "holder_id": str(row.holder_id) if row.holder_id else None,
                # live holder (booked) or, for a resolved fire, whoever resolved it
                # (resolution_officer_name keeps attribution after the officer is deleted)
                "holder_name": row.holder_name or row.resolver_name or row.resolution_officer_name,
                "lat": pt.y,
                "lng": pt.x,
                # ltree region path — lets the ws layer route per-fire deltas to the
                # scopes that can see this fire (see permission.filter_fires)
                "path": row.region_path,
                "tumboon": detail.get("TUMBON"),
                "aumper": detail.get("AUMPER"),
                "province": detail.get("PROVINCE"),
                "type": detail.get("NAME"),
                "satellite": detail.get("SATELLITE"),
            })
        return result


async def get_resolution_history(
    user=None, limit: int = 20, offset: int = 0,
    false_alarm: bool | None = None,
    since: datetime | None = None, until: datetime | None = None,
    officer_id=None,
) -> dict:
    """Resolved fires that have officer evidence, newest first, region-scoped, paged.
    Auto-expired fires have no resolution row, so they don't appear."""
    from .permission import user_region_paths

    async with async_session_maker() as session:
        stmt = (
            select(
                Firespot.id,
                Firespot.name,
                Firespot.detail,
                Firespot.detected_at,
                Firespot.false_alarm,
                FireResolution.id.label("resolution_id"),
                FireResolution.note,
                FireResolution.created_at.label("resolved_at"),
                # live name for an existing officer; denormalized snapshot once deleted
                func.coalesce(FieldOfficer.name, FireResolution.officer_name).label("officer_name"),
            )
            .join(Region, Firespot.region_id == Region.id)
            .join(FireResolution, FireResolution.fire_id == Firespot.id)
            .outerjoin(FieldOfficer, FieldOfficer.id == FireResolution.officer_id)
        )
        # an officer viewing their own history (officer_id set) sees every one of
        # their resolutions; region scope would drop fires from a previous posting
        if user is not None and not user.is_superuser and officer_id is None:
            paths = await user_region_paths(user, session)
            if not paths:
                return {"items": [], "total": 0}
            stmt = stmt.where(or_(*[Region.path.op("<@")(p) for p in paths]))
        if false_alarm is not None:
            stmt = stmt.where(Firespot.false_alarm == false_alarm)
        if officer_id is not None:
            stmt = stmt.where(FireResolution.officer_id == officer_id)
        if since is not None:
            stmt = stmt.where(FireResolution.created_at >= since)
        if until is not None:
            stmt = stmt.where(FireResolution.created_at < until)

        total = (await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
        rows = (await session.execute(
            stmt.order_by(FireResolution.created_at.desc()).limit(limit).offset(offset)
        )).all()

        # image ids per resolution, one query (avoids N+1)
        imgs: dict = {}
        res_ids = [r.resolution_id for r in rows]
        if res_ids:
            for img in (
                await session.execute(
                    select(FireResolutionImage.id, FireResolutionImage.resolution_id)
                    .where(FireResolutionImage.resolution_id.in_(res_ids))
                    .order_by(FireResolutionImage.created_at)
                )
            ).all():
                imgs.setdefault(img.resolution_id, []).append(str(img.id))

        return {"total": total, "items": [{
            "fire_id": str(r.id),
            "name": r.name,
            "tumboon": (r.detail or {}).get("TUMBON"),
            "aumper": (r.detail or {}).get("AUMPER"),
            "province": (r.detail or {}).get("PROVINCE"),
            "detected_at": r.detected_at.isoformat(),
            "resolved_at": r.resolved_at.isoformat(),
            "officer_name": r.officer_name,
            "note": r.note,
            "false_alarm": r.false_alarm,
            "image_ids": imgs.get(r.resolution_id, []),
        } for r in rows]}