"""Capture real wildfire hotspots for a given date into a cached JSON fixture.

Run once (needs network + the backend venv):
    backend/venv/Scripts/python.exe test/fixtures/_fetch_real_fires.py 2026-04-15

Aggregates the feed's per-hotspot records into per-province counts and maps each
province to the same ltree path the app's ingest uses (via fires._build_province_path_map),
so the simulation buckets fires exactly like production does. Province names the
map doesn't recognize are summed under "unmatched" (the app would file them at the
national root).
"""
import json
import sys
from collections import Counter
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app.config import get_settings
from app.db_control.fires import _build_province_path_map

OUT_DIR = Path(__file__).resolve().parent


def fetch(date_str: str) -> list[dict]:
    s = get_settings()
    url = (
        f"{s.WILDFIRE_API_URL}?snpp=on&nighttime=on&daytime=on"
        f"&datestart={date_str}&dateend={date_str}&province=ทุกจังหวัด"
        f"&nrf=on&alow=on&cmf=on&fio=on&dnp=on&alro=on&cp=on&sd=on&dol=on&td=on&other=on&showMap=on"
    )
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    data = r.json()
    return data.get("hotspot", []) if isinstance(data, dict) else data


def build(date_str: str) -> dict:
    hotspots = fetch(date_str)
    path_map = _build_province_path_map()

    by_province_th: Counter[str] = Counter()
    by_path: Counter[str] = Counter()
    unmatched = 0
    for h in hotspots:
        name = (h.get("PROVINCE") or "").strip()
        by_province_th[name] += 1
        path = path_map.get(name)
        if path is None:
            unmatched += 1
        else:
            by_path[path] += 1

    return {
        "date": date_str,
        "source": get_settings().WILDFIRE_API_URL,
        "total": len(hotspots),
        "matched": sum(by_path.values()),
        "unmatched": unmatched,
        "provinces": len(by_path),
        "by_path": dict(by_path.most_common()),
        "by_province_th": dict(by_province_th.most_common()),
    }


if __name__ == "__main__":
    date_str = sys.argv[1] if len(sys.argv) > 1 else "2026-04-15"
    payload = build(date_str)
    out = OUT_DIR / f"fires_{date_str}.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out}")
    print(f"  total={payload['total']} matched={payload['matched']} "
          f"unmatched={payload['unmatched']} provinces={payload['provinces']}")
    top = list(payload["by_path"].items())[:5]
    print(f"  top paths: {top}")
