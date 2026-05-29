import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from ..database.models import User
from .permission import filter_fires, user_region_paths


# Web frontend's static fixture — used until a live source replaces it.
STATIC_FIRE_PATH = (
    Path(__file__).resolve().parents[2] / "web" / "src" / "components" / "markers" / "dataTest01.json"
)


def _slug(value: str | None) -> str:
    if not value:
        return "_"
    s = value.strip().lower()
    # Allow ASCII alnum only; collapse everything else to '_'. ltree labels
    # disallow most punctuation, so we normalize aggressively.
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = s.strip("_") or "_"
    return s


def _path_for(feature: dict) -> str:
    """Derive an ltree path from PROVINCE/AUMPER/TUMBOON. Falls back to '_' segments."""
    province = _slug(feature.get("PROVINCE"))
    aumper = _slug(feature.get("AUMPER"))
    tumboon = _slug(feature.get("TUMBOON"))
    return f"th.{province}.{aumper}.{tumboon}"


@lru_cache(maxsize=1)
def load_static_fires() -> list[dict]:
    if not STATIC_FIRE_PATH.exists():
        return []
    raw = json.loads(STATIC_FIRE_PATH.read_text(encoding="utf-8"))
    out = []
    for i, f in enumerate(raw):
        out.append(
            {
                "id": f"{f.get('DATE','')}-{f.get('TIME','')}-{f.get('LATITUDE')}-{f.get('LONGITUDE')}-{i}",
                "lat": f.get("LATITUDE"),
                "lng": f.get("LONGITUDE"),
                "date": f.get("DATE"),
                "time": f.get("TIME"),
                "province": f.get("PROVINCE"),
                "aumper": f.get("AUMPER"),
                "tumboon": f.get("TUMBOON"),
                "name": f.get("NAME"),
                "type": f.get("TYPE"),
                "path": _path_for(f),
                "raw": f,
            }
        )
    return out


async def list_fires_for(user: User, session: AsyncSession) -> list[dict]:
    paths = await user_region_paths(user, session)
    return filter_fires(paths, load_static_fires(), user.is_superuser)