"""Initial map view (center + zoom) for the region a web user is assigned to.

Centers come from `seedbag/regions_info.json` (the same fixture the regions are
seeded from, so there's one source of truth):
  * province centers are reference points taken from Google Maps,
  * a regional office's center is the mean of its child provinces' centers,
  * the national center is read straight from the fixture.

This is served per-user from /users/me/profile so the web map opens on the area
the user actually covers instead of a hard-coded Bangkok view.
"""
import json
from functools import lru_cache
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent.parent / "database" / "seedbag" / "regions_info.json"

# how tight the opening view sits, by region level
ZOOM_BY_LEVEL = {"national": 5.5, "regional": 8.0, "province": 9.0}

# used when a user has no region (or an unknown one): the whole country
_FALLBACK = {"lat": 13.05, "lng": 101.45, "zoom": ZOOM_BY_LEVEL["national"]}


@lru_cache(maxsize=1)
def _centers() -> dict[str, dict]:
    """Map Region.code -> {lat, lng, zoom}, built once from the fixture."""
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    out: dict[str, dict] = {}

    nat = data["national"]
    if nat.get("center"):
        out[nat["code"]] = {**nat["center"], "zoom": ZOOM_BY_LEVEL["national"]}

    # provinces, while accumulating member centers per regional office
    members: dict[str, list[dict]] = {}
    for pv in data["province"]:
        center = pv.get("center")
        if not center:
            continue
        out[pv["code"]] = {**center, "zoom": ZOOM_BY_LEVEL["province"]}
        members.setdefault(pv["parent_slug"], []).append(center)

    # a regional office sits at the mean of its provinces
    slug_to_code = {ro["slug"]: ro["code"] for ro in data["regional"]}
    for slug, centers in members.items():
        code = slug_to_code.get(slug)
        if code is None:
            continue
        out[code] = {
            "lat": round(sum(c["lat"] for c in centers) / len(centers), 4),
            "lng": round(sum(c["lng"] for c in centers) / len(centers), 4),
            "zoom": ZOOM_BY_LEVEL["regional"],
        }

    return out


def region_view(code: str | None) -> dict:
    """Opening map view for a region code; all-Thailand fallback if unknown."""
    if code is None:
        return dict(_FALLBACK)
    return dict(_centers().get(code, _FALLBACK))
