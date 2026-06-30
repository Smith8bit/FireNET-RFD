import json
from functools import lru_cache
from pathlib import Path

FIXTURE = (
    Path(__file__).resolve().parent.parent
    / "database"
    / "seedbag"
    / "regions_info.json"
)

ZOOM_BY_LEVEL = {"national": 5.5, "regional": 8.0, "province": 9.0}

_FALLBACK_LAT = 13.05
_FALLBACK_LNG = 101.45
_COORD_DECIMALS = 4

_FALLBACK = {
    "lat": _FALLBACK_LAT,
    "lng": _FALLBACK_LNG,
    "zoom": ZOOM_BY_LEVEL["national"],
}


@lru_cache(maxsize=1)
def _centers() -> dict[str, dict]:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}

    nat = data["national"]
    if nat.get("center"):
        out[nat["code"]] = {**nat["center"], "zoom": ZOOM_BY_LEVEL["national"]}
    members: dict[str, list[dict]] = {}
    for pv in data["province"]:
        center = pv.get("center")
        if not center:
            continue
        out[pv["code"]] = {**center, "zoom": ZOOM_BY_LEVEL["province"]}
        members.setdefault(pv["parent_slug"], []).append(center)
    slug_to_code = {ro["slug"]: ro["code"] for ro in data["regional"]}
    for slug, centers in members.items():
        code = slug_to_code.get(slug)
        if code is None:
            continue
        out[code] = {
            "lat": round(
                sum(c["lat"] for c in centers) / len(centers), _COORD_DECIMALS
            ),
            "lng": round(
                sum(c["lng"] for c in centers) / len(centers), _COORD_DECIMALS
            ),
            "zoom": ZOOM_BY_LEVEL["regional"],
        }
    return out


def region_view(code: str | None) -> dict:
    if code is None:
        return dict(_FALLBACK)
    return dict(_centers().get(code, _FALLBACK))
