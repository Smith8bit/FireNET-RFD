import httpx
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ..config import get_settings


# The feed's Apache/mod_security setup 403s requests with the default
# python-requests user-agent, so present browser-like headers (with a Referer
# pointing at the firemap page the API backs).
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

# The feed returns no per-hotspot satellite source, so we fetch each satellite
# separately (one flag on at a time) and tag the records ourselves.
_SATELLITES = {"snpp": "Suomi NPP", "noaa20": "NOAA-20", "noaa21": "NOAA-21"}


def _fetch_one(sat: str, start, today, settings) -> list[dict]:
    url = (
        f"{settings.WILDFIRE_API_URL}"
        f"?{sat}=on&nighttime=on&daytime=on"
        f"&datestart={start:%Y-%m-%d}&dateend={today:%Y-%m-%d}"
        f"&province=ทุกจังหวัด"
        f"&nrf=on&alow=on&cmf=on&fio=on&dnp=on&alro=on&cp=on&sd=on&dol=on&td=on&other=on"
        f"&showMap=on"
    )
    response = httpx.get(url, headers=_FETCH_HEADERS, timeout=15)
    response.raise_for_status()
    data = response.json()
    if isinstance(data, dict):
        return data.get("hotspot", [])
    if isinstance(data, list):
        return data
    return []


def fetch_live_fires() -> list[dict]:
    settings = get_settings()
    today = datetime.now(ZoneInfo(settings.INGEST_TIMEZONE)).date()
    start = today - timedelta(days=settings.INGEST_LOOKBACK_DAYS)
    fires: list[dict] = []
    for sat, label in _SATELLITES.items():
        for f in _fetch_one(sat, start, today, settings):
            # ponytail: a point seen by two satellites at the same minute/coords
            # collides on external_id, so only the first satellite's label is kept.
            f["SATELLITE"] = label
            fires.append(f)
    return fires
