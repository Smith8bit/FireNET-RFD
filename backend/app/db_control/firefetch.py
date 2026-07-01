import httpx
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ..config import get_settings

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
