import json
from functools import lru_cache
from pathlib import Path

# Seed file path resolved relative to this file so it works regardless of CWD.
FIXTURE = (
    Path(__file__).resolve().parent.parent
    / "database"
    / "seedbag"
    / "regions_info.json"
)

# Default zoom levels per administrative tier; calibrated so each tier fits
# comfortably on a mobile screen without requiring manual pan/zoom.
ZOOM_BY_LEVEL = {"national": 5.5, "regional": 8.0, "province": 9.0}

_FALLBACK_LAT = 13.05
_FALLBACK_LNG = 101.45
_COORD_DECIMALS = 4  # ~11 m precision; sufficient for map centering

# Used when no matching region code is found or when ``code`` is None.
_FALLBACK = {
    "lat": _FALLBACK_LAT,
    "lng": _FALLBACK_LNG,
    "zoom": ZOOM_BY_LEVEL["national"],
}


@lru_cache(maxsize=1)
def _centers() -> dict[str, dict]:
    """Load and compute map-center coordinates for every region, cached for the process lifetime.

    Regional centers are derived as the arithmetic mean of their member provinces'
    centers because regional boundaries are not stored as explicit coordinates in
    the seed file.

    Returns:
        ``{region_code: {"lat": float, "lng": float, "zoom": float}, ...}``

    Warning:
        Requires the seed fixture to exist at ``FIXTURE``. If the file changes after
        process start the cache will not reflect the update without a restart.
    """
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
        # Group province centers by their parent regional slug to compute regional means.
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
    """Return the map viewport (center + zoom) for the given region code.

    Args:
        code: Administrative region code (e.g. ``"p50"`` for Chiang Mai province).
              Pass ``None`` to get the national fallback view.

    Returns:
        A fresh dict copy ``{"lat": float, "lng": float, "zoom": float}``.
        Returns the national fallback if ``code`` is ``None`` or unknown.

    Note:
        Returns a copy of the cached entry to prevent callers from mutating the
        shared ``_FALLBACK`` or the ``lru_cache``-held dict in place.
    """
    if code is None:
        return dict(_FALLBACK)
    return dict(_centers().get(code, _FALLBACK))
