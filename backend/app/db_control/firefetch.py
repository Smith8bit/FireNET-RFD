import requests
import json
from datetime import datetime

today = datetime.now().strftime("%Y-%m-%d")

url = (
    "https://wildfire.forest.go.th/firemap/getdb.php"
    f"?snpp=on"
    f"&nighttime=on"
    f"&daytime=on"
    f"&datestart={today}"
    f"&dateend={today}"
    f"&province=ทุกจังหวัด"
    f"&nrf=on"
    f"&alow=on"
    f"&cmf=on"
    f"&fio=on"
    f"&dnp=on"
    f"&alro=on"
    f"&cp=on"
    f"&sd=on"
    f"&dol=on"
    f"&td=on"
    f"&other=on"
    f"&showMap=on"
)

response = requests.get(url)
data = response.json()

print(json.dumps(data, indent=2, ensure_ascii=False))