import requests
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from ..config import get_settings


def fetch_live_fires() -> list[dict]:
    settings = get_settings()
    today = datetime.now(ZoneInfo(settings.INGEST_TIMEZONE)).date()
    start = today - timedelta(days=settings.INGEST_LOOKBACK_DAYS)
    url = (
        f"{settings.WILDFIRE_API_URL}"
        f"?snpp=on&nighttime=on&daytime=on"
        f"&datestart={start:%Y-%m-%d}&dateend={today:%Y-%m-%d}"
        f"&province=ทุกจังหวัด"
        f"&nrf=on&alow=on&cmf=on&fio=on&dnp=on&alro=on&cp=on&sd=on&dol=on&td=on&other=on"
        f"&showMap=on"
    )
    response = requests.get(url, timeout=15)
    response.raise_for_status()
    data = response.json()
    if isinstance(data, dict):
        return data.get("hotspot", [])
    if isinstance(data, list):
        return data
    return []
