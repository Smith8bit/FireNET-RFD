import asyncio
import json
import time
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from ..database.models import User
from .firefetch import fetch_live_fires
from .permission import filter_fires, user_region_paths


_CACHE_TTL = 3600  # 1 hour
_cache: list[dict] = []
_cache_ts: float = 0.0

_FALLBACK_PATH = Path(__file__).resolve().parent / "firedata.json"
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
    """Return the DB-compatible ltree path for a fire record.
    Looks up the province Thai name to get the same path used in the regions table."""
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


def _load_fallback() -> list[dict]:
    if not _FALLBACK_PATH.exists():
        return []
    data = json.loads(_FALLBACK_PATH.read_text(encoding="utf-8"))
    raw = data.get("hotspot", []) if isinstance(data, dict) else data
    return _parse_fires(raw)


async def get_fires() -> list[dict]:
    global _cache, _cache_ts
    now = time.monotonic()
    if _cache and now - _cache_ts < _CACHE_TTL:
        return _cache
    try:
        raw = await asyncio.to_thread(fetch_live_fires)
        fires = _parse_fires(raw)
        _cache = fires
        _cache_ts = now
        return fires
    except Exception as exc:
        print(f"[fires] live fetch failed: {exc}; falling back to firedata.json")
        if not _cache:
            _cache = _load_fallback()
        return _cache


async def list_fires_for(user: User, session: AsyncSession) -> list[dict]:
    paths = await user_region_paths(user, session)
    fires = await get_fires()
    return filter_fires(paths, fires, user.is_superuser)
