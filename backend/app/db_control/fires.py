import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import select
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


def _parse_fires(raw: list[dict]) -> list[dict]:
    out = []
    for i, f in enumerate(raw):
        out.append(
            {
                "id": f"{f.get('YYMMDD','')}-{f.get('TIME','')}-{f.get('LAT')}-{f.get('LONG')}-{i}",
                "lat": f.get("LAT"),
                "lng": f.get("LONG"),
                "date": f.get("YYMMDD"),
                "time": f.get("TIME"),
                "province": f.get("PROVINCE"),
                "aumper": f.get("AUMPER"),
                "tumbon": f.get("TUMBON"),
                "name": f.get("NAME"),
                "type": f.get("TYPE"),
                "path": _path_for(f),
                "raw": f,
            }
        )
    return out


async def _store_fires_to_db(fires: list[dict]) -> None:
    async with async_session_maker() as session:
        result = await session.execute(select(Region.path, Region.id))
        path_to_id = {row.path: row.id for row in result}

        rows: list[dict] = []
        for fire in fires:
            region_id = path_to_id.get(fire["path"])
            if region_id is None:
                continue

            lat, lng = fire.get("lat"), fire.get("lng")
            if lat is None or lng is None:
                continue

            date_str = str(fire.get("date", ""))
            time_str = str(fire.get("time", "0000")).zfill(4)
            detected_at = None
            for fmt in ("%Y-%m-%d%H%M", "%y%m%d%H%M"):
                try:
                    detected_at = datetime.strptime(date_str + time_str, fmt).replace(tzinfo=timezone.utc)
                    break
                except ValueError:
                    continue
            if detected_at is None:
                continue

            rows.append(
                {
                    "external_id": fire["id"],
                    "region_id": region_id,
                    "detected_at": detected_at,
                    "location": from_shape(Point(float(lng), float(lat)), srid=4326),
                    "status": False,
                    "resolve_time": None,
                }
            )

        if rows:
            stmt = insert(Firespot).values(rows).on_conflict_do_nothing(index_elements=["external_id"])
            await session.execute(stmt)
            await session.commit()


async def fetch_and_store() -> None:
    raw = await asyncio.to_thread(fetch_live_fires)
    fires = _parse_fires(raw)
    await _store_fires_to_db(fires)
