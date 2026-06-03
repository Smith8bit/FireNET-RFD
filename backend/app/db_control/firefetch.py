import requests

from apscheduler.schedulers.background import BackgroundScheduler
import atexit

def import_fire_data():

    print("Fetching wildfire data...")

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

    try:

        response = requests.get(url)

        data = response.json()

        hotspots = data.get("hotspot", [])

        db = SessionLocal()

        added = 0

        for spot in hotspots:

            latitude = spot.get("LAT")
            longitude = spot.get("LONG")

            district = spot.get("AUMPER")
            province = spot.get("PROVINCE")

            if not latitude or not longitude:
                continue

            # prevent duplicates
            existing = db.query(FireSpot).filter(
                FireSpot.latitude == latitude,
                FireSpot.longitude == longitude,
                FireSpot.status != "resolved"
            ).first()

            if existing:
                continue

            new_fire = FireSpot(
                latitude=latitude,
                longitude=longitude,
                status="new",
                province=province,
                district=district
            )

            db.add(new_fire)

            added += 1

        db.commit()

        db.close()

        print(f"Imported {added} new fire spots")

    except Exception as e:

        print("Import failed:", e)

import_fire_data()

scheduler = BackgroundScheduler()

scheduler.add_job(
    import_fire_data,
    "interval",
    hours=12
)

scheduler.start()