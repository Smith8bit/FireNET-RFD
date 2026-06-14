"""Super-El-Nino worst-case workflow simulation on REAL fire data.

A strong El Nino turns the northern Thai fire season into a sustained siege:
several record days back-to-back with no overnight relief. We model that by
SUMMING three consecutive real peak days (13, 14, 15 April 2026) into a single
"one day" load and running the full workflow against it — the same system, the
same 10k web / 50k mobile populations, but every burned province carries three
days of hotspots at once:

    2026-04-13   4,514 hotspots
    2026-04-14   3,759 hotspots
    2026-04-15   5,303 hotspots
    -----------------------------
    combined    13,576 hotspots in one day  (~2.6x the single worst day)

Fixtures self-bootstrap from the live feed if missing (needs network + venv):
    backend/venv/Scripts/python.exe test/fixtures/_fetch_real_fires.py 2026-04-13
    backend/venv/Scripts/python.exe test/fixtures/_fetch_real_fires.py 2026-04-14

The broadcasts run scope-bucketed, so this shows the bucketed fan-out and the
DB-free workflow when the fire payload roughly triples while the client
population stays at the national target.

Population knobs (env): SIM_WEB_USERS (10000), SIM_MOBILE_USERS (50000).

Run (prints a report):
    backend/venv/Scripts/python.exe -m pytest test/test_super_elnino_workflow.py -s
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
    combine_real_days,
    load_real_day,
    location_swarm,
)

settings = get_settings()
DAYS = ["2026-04-13", "2026-04-14", "2026-04-15"]

COMBINED = combine_real_days(DAYS)
if COMBINED is None:
    pytest.skip(
        "real fire fixtures for 13-15 Apr 2026 missing and feed unreachable; run "
        "test/fixtures/_fetch_real_fires.py for each date",
        allow_module_level=True,
    )

WORLD = SimWorld(COMBINED["by_path"])
TAG = (f"super El Nino (13-15 Apr 2026 summed) | {WORLD.national_fires} fires / "
       f"{len(WORLD.fire_paths)} provinces")


@pytest.fixture
def world(monkeypatch):
    return WORLD.patch(monkeypatch)


# --------------------------------------------------------------------------
# the scenario itself: 3 real days really do stack into one heavier day
# --------------------------------------------------------------------------
def test_combined_load_is_the_sum_of_three_real_days():
    per_day = COMBINED["per_day"]
    assert set(per_day) == set(DAYS)
    assert WORLD.national_fires == sum(per_day.values())
    worst_single_day = max(per_day.values())
    assert WORLD.national_fires > worst_single_day
    assert len(WORLD.fire_paths) >= max(len(load_real_day(d)["by_path"]) for d in DAYS)
    print(f"\n[{TAG}] per-day {per_day}; combined {WORLD.national_fires} fires "
          f"= {WORLD.national_fires / worst_single_day:.1f}x the worst single day "
          f"(peak province now {WORLD.peak_province_fires})")


# --------------------------------------------------------------------------
# web tier still spans national -> region -> province on the heavier load
# --------------------------------------------------------------------------
def test_web_population_spans_all_account_levels():
    conns = WORLD.build_web_population()
    by_level: dict[str, int] = {}
    for c in conns:
        by_level[c.user.level] = by_level.get(c.user.level, 0) + 1
    print(f"[{TAG}] web tier: {len(conns)} admins = "
          f"{by_level.get('national', 0)} national / {by_level.get('region', 0)} region / "
          f"{by_level.get('province', 0)} province")
    assert by_level["national"] == WORLD.national_superusers
    assert by_level["region"] == len(WORLD.region_paths) * WORLD.region_admins_each
    assert by_level["province"] >= len(WORLD.fire_paths)
    nat = next(c.user for c in conns if c.is_super)
    assert len(WORLD.fire_list_for(nat)) == WORLD.national_fires   # superuser carries all 3 days


# --------------------------------------------------------------------------
# fire broadcast at ~3x payload — bucketed, so DB cost is still O(scopes)
# --------------------------------------------------------------------------
async def test_super_elnino_fire_broadcast_cost_model(world):
    calls, _ = world
    conns = WORLD.build_web_population()
    n_admins = len(conns)
    n_scopes = WORLD.distinct_scopes(conns)

    m = ConnectionManager()
    m.active = conns
    t0 = time.perf_counter()
    await m.broadcast_fires()
    elapsed = time.perf_counter() - t0

    frames = sum(c.ws.frames for c in conns)
    print(f"[{TAG}, peak {WORLD.peak_province_fires}] FIRE broadcast (bucketed): {n_admins} "
          f"admins across {n_scopes} scopes -> {frames} frames, {calls['fires']} get_fires() "
          f"calls in {elapsed*1000:.0f} ms")
    assert calls["fires"] == n_scopes          # still one fetch per scope at 3x payload
    assert frames == n_admins
    assert n_scopes < n_admins
    print(f"    -> {n_admins / n_scopes:.0f}x fewer DB queries than per-connection "
          f"({n_admins} -> {n_scopes})")


async def test_super_elnino_officer_cadence_cost_model(world):
    calls, _ = world
    conns = WORLD.build_web_population()
    n_admins = len(conns)
    n_scopes = WORLD.distinct_scopes(conns)

    t0 = time.perf_counter()
    await oh_mod.broadcast_admin_refresh(conns, include_pending=False)
    elapsed = time.perf_counter() - t0

    frames = sum(c.ws.frames for c in conns)
    print(f"[{TAG}] OFFICER cadence (bucketed): {n_admins} admins -> {frames} frames, "
          f"{calls['officers']} _fetch_officers() calls in {elapsed*1000:.0f} ms; "
          f"cadence budget {WORLD.officer_cadence_s}s")
    assert calls["officers"] == n_scopes
    assert frames == 2 * n_admins


async def test_booking_is_reflected_in_next_broadcast(world):
    _, booked = world
    conns = WORLD.build_web_population()
    target = f"{WORLD.fire_paths[0]}-0"
    booked["id"] = target

    m = ConnectionManager()
    m.active = conns
    await m.broadcast_fires()

    watcher = next(c.ws for c in conns
                   if c.is_super or any(WORLD.fire_paths[0].startswith(p) for p in c.paths))
    fires = {f["id"]: f for f in watcher.last["fires"]["fires"]}
    assert fires[target]["booked"] is True


# --------------------------------------------------------------------------
# mobile load is unchanged by a heavier fire day — 50k ping cadence holds
# --------------------------------------------------------------------------
async def test_mobile_location_swarm_is_sustainable():
    n = WORLD.mobile_users
    t0 = time.perf_counter()
    await location_swarm(n)
    elapsed = time.perf_counter() - t0

    orchestration_rate = n / elapsed if elapsed else float("inf")
    required_rate = n / LOCATION_INTERVAL_S
    db_capacity = (1000.0 / ASSUMED_PING_MS) * settings.DB_POOL_SIZE
    print(f"\n[{TAG}] MOBILE: {n} officers => {required_rate:.0f} pings/s required; "
          f"orchestrated in {elapsed*1000:.0f} ms (~{orchestration_rate:,.0f}/s); "
          f"DB headroom ~{db_capacity:,.0f}/s per worker")
    assert orchestration_rate > required_rate
    assert db_capacity > required_rate


# --------------------------------------------------------------------------
# HEADLINE: web broadcast (3x payload) and the 50k mobile swarm AT THE SAME TIME
# --------------------------------------------------------------------------
async def test_web_and_mobile_run_concurrently(world):
    calls, _ = world
    conns = WORLD.build_web_population()
    n_admins = len(conns)
    n_scopes = WORLD.distinct_scopes(conns)
    m = ConnectionManager()
    m.active = conns

    t0 = time.perf_counter()
    await asyncio.gather(m.broadcast_fires(), location_swarm(WORLD.mobile_users))
    elapsed = time.perf_counter() - t0

    assert calls["fires"] == n_scopes
    assert sum(c.ws.frames for c in conns) == n_admins
    print(f"\n[{TAG}] CONCURRENT worst case: bucketed fire broadcast ({n_scopes} scopes -> "
          f"{n_admins} admins) + {WORLD.mobile_users} mobile pings together in {elapsed*1000:.0f} ms")


def test_report_per_connection_vs_bucketed():
    conns = WORLD.build_web_population()
    n_admins = len(conns)
    n_scopes = WORLD.distinct_scopes(conns)
    q_ms = 5.0

    before_s = n_admins * q_ms / 1000
    now_s = n_scopes * q_ms / 1000
    print(f"\n[{TAG}] per-broadcast DB time @ {q_ms:.0f}ms/query:")
    print(f"    before (per-connection): {n_admins} queries ~ {before_s:.1f} s "
          f"({before_s / WORLD.officer_cadence_s:.0f}x the {WORLD.officer_cadence_s}s cadence)")
    print(f"    now (scope-bucketed):    {n_scopes} queries ~ {now_s*1000:.0f} ms")
    assert now_s < WORLD.officer_cadence_s
    assert now_s < before_s
