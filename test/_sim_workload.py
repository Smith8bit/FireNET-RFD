"""Shared harness for the peak-load workflow simulations.

Builds an admin web population spanning all account levels (national superuser ->
region -> province) plus a field-officer mobile population, and a DB-free data
layer sized to a GIVEN fire load. Tests drive the REAL backend broadcast code
paths (ConnectionManager.broadcast_fires, officer_handlers.broadcast_admin_refresh)
against this harness, so the only thing that changes between scenarios is the
fire-load dict {province ltree path: hotspot count}:

    test_peak_day_workflow.py        single real day  (15 Apr 2026)
    test_super_elnino_workflow.py    3 real days summed into one (13-15 Apr 2026)

Not a test module (pytest.ini collects only test_*.py).
"""
import asyncio
import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import app.ws.manager as manager_mod
import app.ws.officer_handlers as oh_mod
from app.config import get_settings
from app.ws.manager import Connection

settings = get_settings()
FIXT_DIR = Path(__file__).resolve().parent / "fixtures"
LABEL_DATE = date(2026, 4, 15)          # only used for synthetic fire timestamps

# officers ping every 5 minutes; documented single-row UPDATE service time on a
# warm pool, used for the analytic mobile-throughput headroom calc.
LOCATION_INTERVAL_S = 300
ASSUMED_PING_MS = 3.0


def env_int(name, default):
    return int(os.environ.get(name, default))


# --------------------------------------------------------------------------
# real fire fixtures (cached JSON; self-bootstrap from the live feed if missing)
# --------------------------------------------------------------------------
def load_real_day(date_str: str) -> dict | None:
    f = FIXT_DIR / f"fires_{date_str}.json"
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    try:
        sys.path.insert(0, str(FIXT_DIR))
        import _fetch_real_fires as gen
        payload = gen.build(date_str)
        f.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return payload
    except Exception as exc:
        print(f"[sim] could not load real fires {date_str}: {exc}")
        return None


def combine_real_days(date_strs: list[str]) -> dict | None:
    """Sum per-province hotspot counts across several real days into a single
    worst-case 'one day' load (the super-El-Nino scenario)."""
    by_path: dict[str, int] = defaultdict(int)
    per_day: dict[str, int] = {}
    for d in date_strs:
        payload = load_real_day(d)
        if payload is None:
            return None
        per_day[d] = payload["total"]
        for p, c in payload["by_path"].items():
            by_path[p] += c
    ordered = dict(sorted(by_path.items(), key=lambda kv: (-kv[1], kv[0])))
    return {
        "by_path": ordered,
        "total": sum(ordered.values()),
        "provinces": len(ordered),
        "per_day": per_day,
    }


# --------------------------------------------------------------------------
# population primitives
# --------------------------------------------------------------------------
class FakeWS:
    """WebSocket stand-in: counts frames, keeps the last payload of each type."""
    __slots__ = ("frames", "last", "accepted")

    def __init__(self):
        self.frames = 0
        self.last: dict = {}
        self.accepted = False

    async def accept(self) -> None:          # ConnectionManager.connect awaits this
        self.accepted = True

    async def send_json(self, payload) -> None:   # initial per-connection snapshot
        self.frames += 1
        if isinstance(payload, dict):
            self.last[payload.get("type", "fires")] = payload

    async def send_text(self, payload) -> None:   # bucketed fanout (pre-serialized)
        self.frames += 1
        try:
            data = json.loads(payload)
        except (ValueError, TypeError):
            return
        if isinstance(data, dict):
            self.last[data.get("type", "fires")] = data


@dataclass
class SimUser:
    """Mirrors the bits of app.database.models.User the broadcast code reads."""
    id: int
    email: str
    is_superuser: bool
    paths: tuple[str, ...]          # ltree assignments; () for superuser
    level: str                      # "national" | "region" | "province"


class _DummySession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


# --------------------------------------------------------------------------
# the world: a fire load + the populations and DB-free data layer sized to it
# --------------------------------------------------------------------------
class SimWorld:
    def __init__(self, fire_by_path: dict[str, int], *,
                 web_users: int | None = None, mobile_users: int | None = None,
                 national_superusers: int | None = None, region_admins_each: int | None = None):
        self.fire_by_path = fire_by_path
        self.fire_paths = list(fire_by_path)
        self.national_fires = sum(fire_by_path.values())
        self.peak_province_fires = max(fire_by_path.values())

        self.web_users = web_users if web_users is not None else env_int("SIM_WEB_USERS", 10_000)
        self.mobile_users = mobile_users if mobile_users is not None else env_int("SIM_MOBILE_USERS", 50_000)
        self.national_superusers = (national_superusers if national_superusers is not None
                                    else env_int("SIM_NATIONAL_SUPERUSERS", 5))
        self.region_admins_each = (region_admins_each if region_admins_each is not None
                                   else env_int("SIM_REGION_ADMINS_EACH", 3))
        self.officer_cadence_s = settings.OFFICER_REFRESH_INTERVAL_SECONDS

        # region path -> burned province paths beneath it (region = first two labels)
        self.provinces_by_region: dict[str, list[str]] = defaultdict(list)
        for p in self.fire_paths:
            self.provinces_by_region[".".join(p.split(".")[:2])].append(p)
        self.region_paths = list(self.provinces_by_region)

        # field officers spread across burned provinces in proportion to fire load
        self.officers_by_path = self._distribute(self.mobile_users)

    def _distribute(self, total: int) -> dict[str, int]:
        out: dict[str, int] = {}
        rem = total
        last = len(self.fire_paths) - 1
        for i, p in enumerate(self.fire_paths):
            if i == last:
                out[p] = max(rem, 0)
            else:
                share = max(round(total * self.fire_by_path[p] / self.national_fires), 1)
                out[p] = share
                rem -= share
        return out

    # ---- visibility / scope ----
    def visible_provinces(self, user: SimUser) -> list[str]:
        if user.is_superuser:
            return self.fire_paths
        out: list[str] = []
        for assigned in user.paths:
            if assigned in self.fire_by_path:            # province-level assignment
                out.append(assigned)
            else:                                        # region (or higher) — fan in
                out.extend(p for p in self.fire_paths if p.startswith(assigned + "."))
        return out

    @staticmethod
    def scope_key(user: SimUser):
        """Distinct visibility bucket, matching app.ws.manager.Connection.scope_key:
        all superusers collapse to one; everyone else is keyed by their
        order-independent assigned path set."""
        if user.is_superuser:
            return ("\x00super",)
        return tuple(sorted(user.paths))

    def distinct_scopes(self, conns) -> int:
        return len({c.scope_key for c in conns})

    def _conn(self, user: SimUser) -> Connection:
        return Connection(ws=FakeWS(), user=user, is_super=user.is_superuser, paths=user.paths)

    # ---- web population across national -> region -> province ----
    def build_web_population(self) -> list[Connection]:
        conns: list[Connection] = []
        idx = 0
        for _ in range(self.national_superusers):
            conns.append(self._conn(SimUser(idx, f"nat{idx}@x", True, (), "national")))
            idx += 1
        for region in self.region_paths:
            for _ in range(self.region_admins_each):
                conns.append(self._conn(SimUser(idx, f"reg{idx}@x", False, (region,), "region")))
                idx += 1
        budget = max(self.web_users - len(conns), len(self.fire_paths))
        for path, fcount in self.fire_by_path.items():
            for _ in range(max(round(budget * fcount / self.national_fires), 1)):
                conns.append(self._conn(SimUser(idx, f"prov{idx}@x", False, (path,), "province")))
                idx += 1
        return conns

    # ---- get_fires()-shaped payload sized to the real per-province counts ----
    def fire_list_for(self, user: SimUser, booked_id: str | None = None) -> list[dict]:
        out: list[dict] = []
        for p in self.visible_provinces(user):
            for i in range(self.fire_by_path[p]):
                fid = f"{p}-{i}"
                out.append({
                    "id": fid, "name": f"ตำบล #{i}",
                    "detected_at": f"{LABEL_DATE}T0{i % 9}:00:00+07:00",
                    "status": False, "expired": False,
                    "booked": booked_id == fid,
                    "holder_id": None, "holder_name": None,
                    "lat": 18.0 + i * 1e-4, "lng": 98.0 + i * 1e-4,
                    "tumboon": "t", "aumper": "a", "province": "PV", "type": "ไฟป่า",
                })
        return out

    # ---- patch the real broadcast modules' data dependencies (DB-free) ----
    def patch(self, monkeypatch):
        calls = {"fires": 0, "officers": 0}
        booked = {"id": None}
        cap = settings.OFFICER_MAP_MAX          # a national admin must never get the whole fleet

        async def fake_get_fires(region_path=None, status=None, on_date=None, user=None):
            calls["fires"] += 1
            return self.fire_list_for(user, booked["id"])

        async def fake_fetch_officers(session, user):
            calls["officers"] += 1
            provinces = self.visible_provinces(user)
            n = min(sum(max(self.officers_by_path.get(p, 0), 0) for p in provinces), cap)
            path0 = provinces[0] if provinces else "th"
            return [{
                "field_officer_id": f"{path0}-{i}", "user_id": f"u{i}", "name": f"jnt#{i}",
                "email": f"o{i}@x", "active": True, "fire_id": None,
                "last_updated": f"{LABEL_DATE}T03:00:00+00:00",
                "location": {"latitude": 18.0, "longitude": 98.0},
                "province_name_th": "PV", "province_path": path0,
            } for i in range(n)]

        async def always_admin(user, session):
            return True

        monkeypatch.setattr(manager_mod, "get_fires", fake_get_fires)
        monkeypatch.setattr(oh_mod, "_fetch_officers", fake_fetch_officers)
        monkeypatch.setattr(oh_mod, "is_admin_user", always_admin)
        monkeypatch.setattr(oh_mod, "async_session_maker", lambda: _DummySession())
        return calls, booked


async def location_swarm(n: int) -> None:
    """Fire n concurrent DB-free location pings (the PATCH /me/location fast path)."""
    async def ping(_):
        await asyncio.sleep(0)
    await asyncio.gather(*(ping(i) for i in range(n)))


# --------------------------------------------------------------------------
# capacity model: how many concurrent web / mobile clients a deployment sustains
# at peak fire, under the current per-connection broadcast vs the bucketed plan.
# All times are documented assumptions, overridable by env for what-if analysis.
# --------------------------------------------------------------------------
@dataclass
class Deploy:
    # per-connection get_fires / _fetch_officers query time (heavy ltree join)
    web_query_ms: float = float(os.environ.get("SIM_WEB_QUERY_MS", 5.0))
    # single indexed-row location UPDATE on a warm pool
    ping_ms: float = float(os.environ.get("SIM_PING_MS", ASSUMED_PING_MS))
    pool_size: int = settings.DB_POOL_SIZE
    workers: int = env_int("SIM_WORKERS", 8)            # backend worker processes
    sockets_per_worker: int = env_int("SIM_SOCKETS_PER_WORKER", 20_000)
    cadence_s: int = settings.OFFICER_REFRESH_INTERVAL_SECONDS   # officer-list refresh budget
    location_interval_s: int = LOCATION_INTERVAL_S      # officer ping period


def max_web_per_connection(d: Deploy) -> int:
    """A worker's broadcast refetches once per connection and must finish within
    the cadence: conns/worker * query <= cadence. So the web ceiling is DB-bound
    and scales only with workers."""
    return int(d.workers * d.cadence_s / (d.web_query_ms / 1000.0))


def max_web_bucketed(d: Deploy) -> int:
    """With scope bucketing a broadcast issues one query per DISTINCT SCOPE (a
    geography-bounded constant), not per connection — the DB stops scaling with
    users, so the web ceiling becomes the socket/fanout limit instead."""
    return d.workers * d.sockets_per_worker


def max_mobile(d: Deploy) -> int:
    """REST location pings: capacity pings/s * the ping period. Independent of the
    web broadcast model."""
    capacity_per_s = (1000.0 / d.ping_ms) * d.pool_size * d.workers
    return int(capacity_per_s * d.location_interval_s)


def max_pair(web_cap: int, mobile_cap: int, mobile_per_web: int) -> tuple[int, int, str]:
    """Largest (web, mobile) honouring mobile = mobile_per_web * web and both caps."""
    web = min(web_cap, mobile_cap // mobile_per_web)
    binding = "web" if web_cap <= mobile_cap // mobile_per_web else "mobile"
    return web, web * mobile_per_web, binding
