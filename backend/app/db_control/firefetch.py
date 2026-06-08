import requests
from datetime import datetime, timedelta


def fetch_live_fires() -> list[dict]:
    today = datetime.now()- timedelta(days=1)
    today = today.strftime("%Y-%m-%d")
    url = (
        "https://wildfire.forest.go.th/firemap/getdb.php"
        f"?snpp=on&nighttime=on&daytime=on"
        f"&datestart={today}&dateend={today}"
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
