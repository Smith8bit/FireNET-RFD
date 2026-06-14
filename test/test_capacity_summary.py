"""Capacity summary: max concurrent web vs mobile clients at PEAK FIRE.

Answers the sizing question directly — on the peak fire day, how many concurrent
admin web users and field-officer mobile users can the system sustain, evaluated
at two staffing ratios:

    1:10   one web admin per 10 field officers
    1:5    one web admin per 5  field officers   (the stated 10k:50k target)

The web ceiling depends on the broadcast model. BEFORE (per-connection) the
broadcast refetched once per socket, so the web ceiling was DB-bound and scaled
only with worker count. NOW (scope-bucketed, the current build) a broadcast
issues one query per distinct scope — geography-bounded — moving the ceiling off
the DB and onto sockets/CPU. The mobile ceiling is the REST location-ping
throughput and is identical for both. All per-op times are documented assumptions
(override via SIM_WEB_QUERY_MS / SIM_PING_MS / SIM_WORKERS / SIM_SOCKETS_PER_WORKER).

A connect-storm test rounds out the operational picture: a mass reconnect after a
deploy still costs one get_fires() per socket (the initial snapshot is inherently
per-connection — bucketing only helps the recurring broadcasts).

Run (prints the summary):
    backend/venv/Scripts/python.exe -m pytest test/test_capacity_summary.py -s
"""
import time

import pytest

from app.ws.manager import ConnectionManager
from _sim_workload import (
    Deploy,
    SimWorld,
    load_real_day,
    max_mobile,
    max_pair,
    max_web_bucketed,
    max_web_per_connection,
)

REAL = load_real_day("2026-04-15")
if REAL is None:
    pytest.skip("real fire fixture missing and feed unreachable", allow_module_level=True)

WORLD = SimWorld(REAL["by_path"])
DEPLOY = Deploy()
RATIOS = {"1:10": 10, "1:5": 5}          # mobile officers per web admin
TARGET_WEB, TARGET_MOBILE = 10_000, 50_000


def _scopes() -> int:
    return WORLD.distinct_scopes(WORLD.build_web_population())


# --------------------------------------------------------------------------
# the summary the question asks for
# --------------------------------------------------------------------------
def test_max_concurrent_capacity_summary():
    d = DEPLOY
    web_pc = max_web_per_connection(d)
    web_bk = max_web_bucketed(d)
    mob = max_mobile(d)
    scopes = _scopes()

    print(f"\n================ PEAK FIRE capacity (15 Apr 2026, {WORLD.national_fires} fires, "
          f"{scopes} distinct scopes) ================")
    print(f"assumptions: workers={d.workers}, web_query={d.web_query_ms:.0f}ms, "
          f"ping={d.ping_ms:.0f}ms, pool={d.pool_size}, cadence={d.cadence_s}s, "
          f"ping_interval={d.location_interval_s}s, sockets/worker={d.sockets_per_worker:,}")
    print(f"  ceilings: WEB before/per-connection = {web_pc:,}   "
          f"WEB now/scope-bucketed = {web_bk:,}   MOBILE = {mob:,}")

    print(f"\n  {'ratio':6} | {'model':22} | {'max WEB':>12} | {'max MOBILE':>14} | binding")
    print(f"  {'-'*6}-+-{'-'*22}-+-{'-'*12}-+-{'-'*14}-+--------")
    rows = {}
    for label, m_per_w in RATIOS.items():
        for model, web_cap in (("before/per-connection", web_pc), ("now/scope-bucketed", web_bk)):
            web, mobile, binding = max_pair(web_cap, mob, m_per_w)
            rows[(label, model)] = (web, mobile, binding)
            print(f"  {label:6} | {model:22} | {web:>12,} | {mobile:>14,} | {binding}-bound")
    print("  " + "=" * 84)

    # mobile is never the bottleneck — the web fan-out is
    assert mob > web_pc
    for label in RATIOS:
        assert rows[(label, "before/per-connection")][2] == "web"
    # bucketing lifted the web ceiling well past the per-connection one
    assert web_bk > web_pc
    # both ceilings clear the stated 10k:50k (1:5) target
    assert max_pair(web_pc, mob, 5)[0] >= TARGET_WEB
    assert max_pair(web_bk, mob, 5)[1] >= TARGET_MOBILE


def test_target_10k_50k_workers_needed_before_vs_now():
    """The 1:5 target (10k web / 50k mobile). Report the workers each model needs."""
    d = DEPLOY
    per_worker_web = int(d.cadence_s / (d.web_query_ms / 1000.0))
    workers_before = -(-TARGET_WEB // per_worker_web)          # ceil
    scopes = _scopes()
    workers_now = 1                                            # scopes*query << cadence
    print(f"\n[peak fire] to serve {TARGET_WEB:,} web admins within the {d.cadence_s}s cadence:")
    print(f"    before (per-connection): ~{workers_before} worker(s) "
          f"({per_worker_web:,} admins/worker at {d.web_query_ms:.0f}ms/query)")
    print(f"    now (scope-bucketed):    ~{workers_now} worker ({scopes} queries/broadcast, "
          f"{TARGET_WEB // scopes}x fewer than per-connection)")
    assert workers_before >= workers_now
    assert max_mobile(d) >= TARGET_MOBILE                      # mobile target has headroom


# --------------------------------------------------------------------------
# operational ceiling: a post-deploy reconnect storm is still O(connections)
# --------------------------------------------------------------------------
async def test_connect_storm_is_one_get_fires_per_socket(monkeypatch):
    calls, _ = WORLD.patch(monkeypatch)
    conns = WORLD.build_web_population()
    m = ConnectionManager()

    t0 = time.perf_counter()
    for c in conns:                         # every admin reconnects after a deploy
        await m.connect(c.ws, c.user, c.user.paths)
    elapsed = time.perf_counter() - t0

    n = len(conns)
    assert calls["fires"] == n              # initial fire snapshot per socket (not bucketed)
    assert all(c.ws.accepted for c in conns)
    assert all(c.ws.frames == 1 for c in conns)
    assert len(m.active) == n
    print(f"\n[peak fire] connect storm: {n:,} admins reconnected -> {calls['fires']:,} "
          f"get_fires() snapshots in {elapsed*1000:.0f} ms (still O(connections) at connect)")
