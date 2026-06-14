"""Peak-day workflow simulation on REAL fire data — a single day, 15 April 2026.

Drives the ACTUAL backend broadcast/workflow code paths (ConnectionManager.
broadcast_fires, officer_handlers.broadcast_admin_refresh) against a DB-free data
layer sized to the real wildfire feed for 2026-04-15 (5,303 hotspots across 57
provinces, heavily skewed to the north — see fixtures/fires_2026-04-15.json), and
runs the web and mobile populations through the same fire-handling workflow
CONCURRENTLY at the stated national peak:

    SIM_WEB_USERS     (default 10000)   admin web clients on /ws, mixed account
                                        levels: national -> region -> province
    SIM_MOBILE_USERS  (default 50000)   field officers (mobile, REST)

The web broadcasts run UNMODIFIED, so one broadcast costs O(connections) DB
round-trips on this build. The tests assert that directly (fetches == admins) and
print the contrast against the number of distinct scopes — the count a
scope-bucketed fan-out would need. The combined 3-day worst case lives in
test_super_elnino_workflow.py; the shared harness is _sim_workload.py.

Run (prints a report):
    backend/venv/Scripts/python.exe -m pytest test/test_peak_day_workflow.py -s
"""
import asyncio
import time

import pytest

from app.config import get_settings
from app.ws.manager import ConnectionManager
import app.ws.officer_handlers as oh_mod
from _sim_workload import (
    ASSUMED_PING_MS,
    LOCATION_INTERVAL_S,
    SimWorld,
    load_real_day,
    location_swarm,
)

settings = get_settings()

REAL = load_real_day("2026-04-15")
if REAL is None:
    pytest.skip(
        "real fire fixture missing and feed unreachable; run "
        "test/fixtures/_fetch_real_fires.py 2026-04-15",
        allow_module_level=True,
    )

WORLD = SimWorld(REAL["by_path"])
TAG = f"15 Apr 2026 | {WORLD.national_fires} real fires / {len(WORLD.fire_paths)} provinces"


@pytest.fixture
def world(monkeypatch):
    return WORLD.patch(monkeypatch)


# --------------------------------------------------------------------------
def test_web_population_spans_all_account_levels():
    conns = WORLD.build_web_population()
    by_level: dict[str, int] = {}
    for _, u in conns:
        by_level[u.level] = by_level.get(u.level, 0) + 1
    print(f"\n[{TAG}] web tier: {len(conns)} admins = "
          f"{by_level.get('national', 0)} national / {by_level.get('region', 0)} region / "
          f"{by_level.get('province', 0)} province")
    assert by_level["national"] == WORLD.national_superusers
    assert by_level["region"] == len(WORLD.region_paths) * WORLD.region_admins_each
    assert by_level["province"] >= len(WORLD.fire_paths)
    nat = next(u for _, u in conns if u.is_superuser)
    prov = next(u for _, u in conns if u.level == "province")
    assert len(WORLD.fire_list_for(nat)) == WORLD.national_fires
    assert len(WORLD.fire_list_for(prov)) == WORLD.fire_by_path[prov.paths[0]]


async def test_peak_day_fire_broadcast_cost_model(world):
    calls, _ = world
    conns = WORLD.build_web_population()
    n_admins = len(conns)
    n_scopes = WORLD.distinct_scopes(conns)

    m = ConnectionManager()
    m.active = conns
    t0 = time.perf_counter()
    await m.broadcast_fires()
    elapsed = time.perf_counter() - t0

    frames = sum(ws.frames for ws, _ in conns)
    print(f"[{TAG}, peak {WORLD.peak_province_fires}] FIRE broadcast: {n_admins} admins, "
          f"{n_scopes} distinct scopes -> {frames} frames, {calls['fires']} get_fires() "
          f"calls in {elapsed*1000:.0f} ms")
    assert calls["fires"] == n_admins          # current build refetches per CONNECTION
    assert frames == n_admins
    assert n_scopes < n_admins
    print(f"    -> scope-bucketed fan-out would issue {n_scopes} queries, "
          f"{n_admins / n_scopes:.0f}x fewer than the {n_admins} this build makes")


async def test_peak_day_officer_cadence_cost_model(world):
    calls, _ = world
    conns = WORLD.build_web_population()
    n_admins = len(conns)

    t0 = time.perf_counter()
    await oh_mod.broadcast_admin_refresh(conns, include_pending=False)
    elapsed = time.perf_counter() - t0

    frames = sum(ws.frames for ws, _ in conns)
    print(f"[{TAG}] OFFICER cadence: {n_admins} admins -> {frames} frames, "
          f"{calls['officers']} _fetch_officers() calls in {elapsed*1000:.0f} ms; "
          f"cadence budget {WORLD.officer_cadence_s}s")
    assert calls["officers"] == n_admins       # one fleet query per admin, per tick
    assert frames == 2 * n_admins              # officers_in_region + officers_map


async def test_booking_is_reflected_in_next_broadcast(world):
    _, booked = world
    conns = WORLD.build_web_population()
    target = f"{WORLD.fire_paths[0]}-0"         # reserve fire #0 in the worst province
    booked["id"] = target

    m = ConnectionManager()
    m.active = conns
    await m.broadcast_fires()

    watcher = next(ws for ws, u in conns
                   if u.is_superuser or any(WORLD.fire_paths[0].startswith(p) for p in u.paths))
    fires = {f["id"]: f for f in watcher.last["fires"]["fires"]}
    assert fires[target]["booked"] is True


async def test_mobile_location_swarm_is_sustainable():
    n = WORLD.mobile_users
    t0 = time.perf_counter()
    await location_swarm(n)
    elapsed = time.perf_counter() - t0

    orchestration_rate = n / elapsed if elapsed else float("inf")
    required_rate = n / LOCATION_INTERVAL_S
    db_capacity = (1000.0 / ASSUMED_PING_MS) * settings.DB_POOL_SIZE
    print(f"\n[{TAG}] MOBILE: {n} officers pinging every {LOCATION_INTERVAL_S}s "
          f"=> {required_rate:.0f} pings/s required")
    print(f"    orchestrated {n} concurrent pings in {elapsed*1000:.0f} ms "
          f"(~{orchestration_rate:,.0f}/s loop throughput)")
    print(f"    DB headroom @ {ASSUMED_PING_MS:.0f}ms/UPDATE, pool={settings.DB_POOL_SIZE}: "
          f"~{db_capacity:,.0f} pings/s per worker")
    assert orchestration_rate > required_rate
    assert db_capacity > required_rate


async def test_mobile_reservation_wave_keeps_fcfs_invariants():
    """A wave of officers reserve fires in their own province. The real rule:
    a fire is held by at most one officer, an officer holds at most one fire."""
    fire_holder: dict[str, str] = {}
    officer_fire: dict[str, str] = {}
    lock = asyncio.Lock()
    granted = {"n": 0}

    async def reserve(officer_id: str, fire_id: str):
        async with lock:                        # stands in for the DB uniqueness guard
            if fire_id in fire_holder or officer_id in officer_fire:
                return
            fire_holder[fire_id] = officer_id
            officer_fire[officer_id] = fire_id
            granted["n"] += 1

    jobs = []
    for p in WORLD.fire_paths[:3]:
        for i in range(WORLD.fire_by_path[p]):
            jobs.append(reserve(f"{p}-officer-{i}", f"{p}-{i}"))
    await asyncio.gather(*jobs)

    assert len(set(fire_holder.values())) == len(fire_holder)
    assert all(officer_fire[o] == f for f, o in fire_holder.items())
    print(f"\n[{TAG}] MOBILE reservation wave: {granted['n']} fires reserved, FCFS held")


async def test_web_and_mobile_run_concurrently(world):
    calls, _ = world
    conns = WORLD.build_web_population()
    n_admins = len(conns)
    m = ConnectionManager()
    m.active = conns

    t0 = time.perf_counter()
    await asyncio.gather(m.broadcast_fires(), location_swarm(WORLD.mobile_users))
    elapsed = time.perf_counter() - t0

    assert calls["fires"] == n_admins
    assert sum(ws.frames for ws, _ in conns) == n_admins
    print(f"\n[{TAG}] CONCURRENT peak: {n_admins} web fire-broadcasts + "
          f"{WORLD.mobile_users} mobile pings together in {elapsed*1000:.0f} ms")


def test_report_per_connection_vs_bucketed():
    conns = WORLD.build_web_population()
    n_admins = len(conns)
    n_scopes = WORLD.distinct_scopes(conns)
    q_ms = 5.0

    per_conn_s = n_admins * q_ms / 1000
    bucketed_s = n_scopes * q_ms / 1000
    print(f"\n[{TAG}] per-broadcast DB time @ {q_ms:.0f}ms/query:")
    print(f"    this build (per-connection): {n_admins} queries ~ {per_conn_s:.1f} s "
          f"({per_conn_s / WORLD.officer_cadence_s:.0f}x the {WORLD.officer_cadence_s}s cadence)")
    print(f"    scope-bucketed (planned):    {n_scopes} queries ~ {bucketed_s*1000:.0f} ms")
    assert bucketed_s < WORLD.officer_cadence_s
    assert per_conn_s > bucketed_s
