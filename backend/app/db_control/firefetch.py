"""Hotspot ingest: fetch from the national wildfire feed and persist to PostGIS.

The scheduler calls `update_fires`, which fetches across all satellites
(`fetch_live_fires`) and upserts new firespots via `_store_fires_to_db`.
"""

import asyncio
import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert

from ..config import get_settings
from ..database import async_session_maker
from ..database.models.firespot import Firespot
from ..database.models.region import Region
from .audit import audit

# Mimic a real browser request; the Thai government wildfire API rejects plain
# script user-agents with 403. Referer and X-Requested-With headers are checked.
_FETCH_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "th,en;q=0.9",
    "Referer": "https://wildfire.forest.go.th/firemap/",
    "X-Requested-With": "XMLHttpRequest",
}

# All three satellites are queried on every cycle to maximise spatial coverage;
# labels are used for audit logging and the ``satellite`` display field.
_SATELLITES = {"snpp": "Suomi NPP", "noaa20": "NOAA-20", "noaa21": "NOAA-21"}
_FETCH_TIMEOUT_S = 15

# Resolved once at import; used to locate the province-to-path seed file without
# relying on a working directory assumption.
_REGIONS_PATH = (
    Path(__file__).resolve().parents[1] / "database" / "seedbag" / "regions_info.json"
)


def _fetch_one(sat: str, start, today, settings) -> list[dict]:
    """Fetch hotspot records from the wildfire API for a single satellite.

    Args:
        sat:      Short satellite key (e.g. ``"noaa20"``); used as a query parameter.
        start:    Start date for the lookback window (``date`` object).
        today:    End date (``date`` object, inclusive).
        settings: App settings providing ``WILDFIRE_API_URL``.

    Returns:
        List of raw hotspot dicts. Returns ``[]`` on unexpected response shape.

    Warning:
        The API returns a dict ``{"hotspot": [...]}`` when results exist but a bare
        list ``[...]`` for some responses — both cases are handled explicitly.
    """
    url = (
        f"{settings.WILDFIRE_API_URL}"
        f"?{sat}=on&nighttime=on&daytime=on"
        f"&datestart={start:%Y-%m-%d}&dateend={today:%Y-%m-%d}"
        f"&province=ทุกจังหวัด"
        f"&nrf=on&alow=on&cmf=on&fio=on&dnp=on&alro=on&cp=on&sd=on&dol=on&td=on&other=on"
        f"&showMap=on"
    )
    response = httpx.get(url, headers=_FETCH_HEADERS, timeout=_FETCH_TIMEOUT_S)
    response.raise_for_status()
    data = response.json()
    if isinstance(data, dict):
        return data.get("hotspot", [])
    if isinstance(data, list):
        return data
    return []


def fetch_live_fires() -> list[dict]:
    """Aggregate hotspot records across all configured satellites.

    Uses the ingest timezone (not UTC) to determine "today" so the lookback window
    aligns with local operational reporting cycles.

    Returns:
        Combined list of hotspot dicts, each annotated with a human-readable
        ``"SATELLITE"`` key for downstream audit and display.

    Note:
        This function is synchronous (uses ``httpx`` in blocking mode) and must be
        called via ``asyncio.to_thread`` when used from an async context.
    """
    settings = get_settings()
    today = datetime.now(ZoneInfo(settings.INGEST_TIMEZONE)).date()
    start = today - timedelta(days=settings.INGEST_LOOKBACK_DAYS)
    fires: list[dict] = []
    for sat, label in _SATELLITES.items():
        for f in _fetch_one(sat, start, today, settings):
            f["SATELLITE"] = label
            fires.append(f)
    return fires


def _build_province_path_map() -> dict[str, str]:
    """Build a Thai province name → ltree path mapping from the seed fixture.

    Called once at import; result stored in ``_PROVINCE_PATH``.
    Returns an empty dict if the seed file is missing so the import never fails.

    Returns:
        ``{"เชียงใหม่": "th.r1.p50", ...}``
    """
    if not _REGIONS_PATH.exists():
        return {}
    data = json.loads(_REGIONS_PATH.read_text(encoding="utf-8"))
    nat_slug = data["national"]["slug"]
    result: dict[str, str] = {}
    for pv in data.get("province", []):
        name_th = pv.get("name_th", "").strip()
        if name_th:
            # Path format: <national>.<regional>.<province>
            result[name_th] = f"{nat_slug}.{pv['parent_slug']}.{pv['slug']}"
    return result


# Computed once; used by _path_for() on every ingested fire record.
_PROVINCE_PATH: dict[str, str] = _build_province_path_map()


def _path_for(feature: dict) -> str:
    """Resolve the ltree region path for a raw hotspot feature.

    Args:
        feature: Raw dict from the wildfire API containing a ``"PROVINCE"`` key.

    Returns:
        ltree path string, or ``"th"`` (national root) if the province is unknown.
    """
    province_th = (feature.get("PROVINCE") or "").strip()
    return _PROVINCE_PATH.get(province_th, "th")


def number_new_fires(
    parsed: list[dict], existing_ext: set[str], seed_counts: dict[tuple[str, str], int]
) -> list[dict]:
    """Assign sequential display names to fires that don't yet exist in the DB.

    Names follow the pattern ``"<tumboon> #<N>"`` where N is the count of fires
    in the same sub-district on the same UTC date, including previously stored ones
    (``seed_counts`` pre-loads those counts so numbering is globally consistent).

    Args:
        parsed:       Candidate fire dicts, each with ``external_id``, ``tumboon``, ``day``.
        existing_ext: Set of ``external_id`` values already in the database (dedup guard).
        seed_counts:  Pre-existing per-(tumboon, day) counts from the DB for the date range.

    Returns:
        Subset of ``parsed`` that are genuinely new, each augmented with a ``"name"`` key.
    """
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
    """Core ingest pipeline: parse, deduplicate, and persist hotspot records.

    Steps performed inside a single transaction:
    1. Resolve each fire's province to a DB region_id via ltree path.
    2. Parse the API's inconsistent datetime format (YYMMDD vs YYYYMMDD).
    3. Deduplicate against existing ``external_id`` values.
    4. Seed per-(tumboon, date) counts for sequential naming.
    5. Upsert with ``ON CONFLICT DO NOTHING`` as a safety net for races.
    6. Append an audit entry with ingest statistics.

    Args:
        fires: List of raw hotspot dicts from the wildfire API, each already tagged
               with a ``"path"`` key (added by ``update_fires``).

    Warning:
        Fires with an unresolvable ``path`` or missing lat/lng are silently skipped.
    """
    async with async_session_maker() as session:
        result = await session.execute(select(Region.path, Region.id))
        path_to_id = {row.path: row.id for row in result}

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
            # The API inconsistently uses both 2-digit and 4-digit year prefixes.
            for fmt in ("%Y-%m-%d%H%M", "%y%m%d%H%M"):
                try:
                    detected_at = datetime.strptime(date_str + time_str, fmt).replace(
                        tzinfo=timezone.utc
                    )
                    break
                except ValueError:
                    continue
            if detected_at is None:
                continue
            parsed.append(
                {
                    "tumboon": fire.get("TUMBON", "") or "ไม่ทราบตำบล",
                    "day": detected_at.date().isoformat(),
                    "detected_at": detected_at,
                    "region_id": region_id,
                    "lat": lat,
                    "lng": lng,
                    # Preserve only the known structured keys; ignore undocumented fields.
                    "detail": {
                        k: fire[k]
                        for k in (
                            "SATELLITE",
                            "TUMBON",
                            "AUMPER",
                            "PROVINCE",
                            "TYPE",
                            "NAME",
                            "FOREST",
                            "OWN",
                        )
                        if k in fire
                    },
                    # Compound key uniquely identifies a sensor reading across fetches.
                    "external_id": f"{fire.get('YYMMDD','')}-{fire.get('TIME','')}-{fire.get('LAT','')}-{fire.get('LONG','')}",
                }
            )
        ext_ids = [p["external_id"] for p in parsed]
        existing_ext = (
            set(
                (
                    await session.execute(
                        select(Firespot.external_id).where(
                            Firespot.external_id.in_(ext_ids)
                        )
                    )
                )
                .scalars()
                .all()
            )
            if ext_ids
            else set()
        )

        # Seed counts only cover the date range of this batch to keep the query tight.
        seed_counts: dict[tuple[str, str], int] = {}
        if parsed:
            min_day = min(p["day"] for p in parsed)
            seed = await session.execute(
                text(
                    "SELECT COALESCE(NULLIF(detail->>'TUMBON',''),'ไม่ทราบตำบล') AS tumbon, "
                    "(detected_at AT TIME ZONE 'UTC')::date::text AS d, count(*) AS c "
                    "FROM firespots WHERE (detected_at AT TIME ZONE 'UTC')::date >= CAST(:min_day AS date) "
                    "GROUP BY 1, 2"
                ).bindparams(min_day=min_day)
            )
            seed_counts = {(r.tumbon, r.d): r.c for r in seed}
        rows = [
            {
                "name": p["name"],
                "detail": p["detail"],
                "external_id": p["external_id"],
                "region_id": p["region_id"],
                "detected_at": p["detected_at"],
                # SRID 4326 = WGS-84; required for PostGIS spatial queries.
                "location": from_shape(
                    Point(float(p["lng"]), float(p["lat"])), srid=4326
                ),
                "status": False,   # new fires start unresolved
                "resolve_time": None,
            }
            for p in number_new_fires(parsed, existing_ext, seed_counts)
        ]
        inserted = 0
        if rows:
            # ON CONFLICT DO NOTHING guards against concurrent ingest jobs inserting
            # the same fire between our dedup check and this insert.
            stmt = (
                insert(Firespot)
                .values(rows)
                .on_conflict_do_nothing(index_elements=["external_id"])
                .returning(Firespot.id)
            )
            inserted = len((await session.execute(stmt)).scalars().all())
        by_satellite = dict(Counter(f.get("SATELLITE", "?") for f in fires))
        audit(
            session,
            actor=None,  # system-initiated; no human actor
            action="fire.ingest",
            entity_type="fire",
            detail={
                "fetched": len(fires),
                "inserted": inserted,
                "skipped": len(fires) - inserted,
                "by_satellite": by_satellite,
            },
        )
        await session.commit()


async def update_fires() -> None:
    """Entry point called by the scheduler to pull and persist the latest hotspots.

    ``fetch_live_fires`` uses the synchronous ``httpx`` client; ``asyncio.to_thread``
    prevents it from blocking the event loop.
    """
    fires = await asyncio.to_thread(fetch_live_fires)
    print(f"[update_fires] fetched={len(fires)}")
    for fire in fires:
        fire["path"] = _path_for(fire)
    await _store_fires_to_db(fires)
    print(f"[update_fires] completed")
    return
