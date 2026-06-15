"""Per-fire deltas — the change that turns a fire broadcast from "re-send every
scope's whole list" into "send only the fires that changed, routed to the scopes
that can see them". These guard the diff, the per-scope routing, the snapshot/
version baseline, and the live refresh_and_broadcast_deltas path.

Pure-logic and DB-free: the diff/route helpers are static, and the live path is
driven by monkeypatching app.ws.manager.get_fires with a synthetic national set.
"""
import json

import pytest

import app.ws.manager as manager_mod
from app.ws.manager import Connection, ConnectionManager


class FakeWS:
    """Minimal WebSocket stand-in that records what was sent."""

    def __init__(self):
        self.sent: list[str] = []
        self.accepted = False

    async def accept(self) -> None:
        self.accepted = True

    async def send_text(self, payload: str) -> None:
        self.sent.append(payload)


class FakeUser:
    def __init__(self, email, is_superuser=False):
        self.email = email
        self.id = email
        self.is_superuser = is_superuser


def _conn(email, *, is_super=False, paths=()):
    return Connection(ws=FakeWS(), user=FakeUser(email, is_super), is_super=is_super, paths=paths)


def fire(fid, path, **over):
    """A get_fires()-shaped fire dict carrying the `path` deltas route on."""
    f = {
        "id": fid, "path": path, "name": fid,
        "detected_at": "2026-04-15T01:00:00+07:00",
        "status": False, "expired": False, "booked": False,
        "holder_id": None, "holder_name": None,
        "lat": 18.0, "lng": 98.0, "tumboon": "t", "aumper": "a",
        "province": "PV", "type": "ไฟป่า",
    }
    f.update(over)
    return f


def _last(ws) -> dict:
    return json.loads(ws.sent[-1])


def _patch_fires(monkeypatch, state):
    async def fake_get_fires(region_path=None, status=None, on_date=None, user=None):
        return list(state["fires"])
    monkeypatch.setattr(manager_mod, "get_fires", fake_get_fires)


# --------------------------------------------------------------------------
# pure diff
# --------------------------------------------------------------------------
def test_diff_detects_new_and_changed_only():
    old = {"a": fire("a", "th.r1.p50"), "b": fire("b", "th.r1.p51")}
    new = [
        fire("a", "th.r1.p50"),                  # unchanged
        fire("b", "th.r1.p51", booked=True),     # changed
        fire("c", "th.r2.p60"),                  # new
    ]
    upserts, removed = ConnectionManager.diff_fires(old, new)
    assert sorted(f["id"] for f in upserts) == ["b", "c"]   # unchanged 'a' excluded
    assert removed == []


def test_diff_reports_removed_with_old_dict():
    old = {"a": fire("a", "th.r1.p50"), "b": fire("b", "th.r2.p60")}
    new = [fire("a", "th.r1.p50")]
    upserts, removed = ConnectionManager.diff_fires(old, new)
    assert upserts == []
    assert [f["id"] for f in removed] == ["b"]
    assert removed[0]["path"] == "th.r2.p60"               # path kept for routing


# --------------------------------------------------------------------------
# per-scope routing (reuses permission.filter_fires)
# --------------------------------------------------------------------------
def test_route_province_sees_only_its_own():
    ups = [fire("a", "th.r1.p50"), fire("b", "th.r2.p60")]
    vis_up, vis_rm = ConnectionManager.route_delta(["th.r1.p50"], False, ups, [])
    assert [f["id"] for f in vis_up] == ["a"]
    assert vis_rm == []


def test_route_region_covers_its_provinces():
    ups = [fire("a", "th.r1.p50"), fire("b", "th.r1.p51"), fire("c", "th.r2.p60")]
    vis_up, _ = ConnectionManager.route_delta(["th.r1"], False, ups, [])
    assert sorted(f["id"] for f in vis_up) == ["a", "b"]    # both provinces under r1


def test_route_superuser_sees_all():
    ups = [fire("a", "th.r1.p50"), fire("b", "th.r2.p60")]
    vis_up, _ = ConnectionManager.route_delta([], True, ups, [])
    assert sorted(f["id"] for f in vis_up) == ["a", "b"]


def test_route_removed_by_path():
    removed = [fire("a", "th.r1.p50"), fire("b", "th.r2.p60")]
    _, vis_rm = ConnectionManager.route_delta(["th.r2.p60"], False, [], removed)
    assert vis_rm == ["b"]


# --------------------------------------------------------------------------
# live path: refresh_and_broadcast_deltas
# --------------------------------------------------------------------------
async def test_booking_sends_one_upsert_to_affected_scope_only(monkeypatch):
    prov50 = _conn("p50", paths=("th.r1.p50",))
    prov60 = _conn("p60", paths=("th.r2.p60",))
    nat = _conn("nat", is_super=True)
    m = ConnectionManager()
    m.active = [prov50, prov60, nat]

    state = {"fires": [fire("a", "th.r1.p50"), fire("b", "th.r2.p60")]}
    _patch_fires(monkeypatch, state)

    await m.refresh_and_broadcast_deltas()                  # warm the registry
    for c in m.active:
        c.ws.sent.clear()

    state["fires"] = [fire("a", "th.r1.p50", booked=True), fire("b", "th.r2.p60")]
    await m.refresh_and_broadcast_deltas()

    # affected province gets exactly the one changed fire
    assert len(prov50.ws.sent) == 1
    d50 = _last(prov50.ws)
    assert d50["type"] == "fires_delta"
    assert [f["id"] for f in d50["upserts"]] == ["a"]
    assert d50["upserts"][0]["booked"] is True
    assert d50["removes"] == []
    # the other province is silent — a booking elsewhere no longer touches it
    assert prov60.ws.sent == []
    # national gets ONLY the changed fire, never the whole national list
    dnat = _last(nat.ws)
    assert [f["id"] for f in dnat["upserts"]] == ["a"]


async def test_resolved_fire_is_removed_from_scope(monkeypatch):
    prov = _conn("p50", paths=("th.r1.p50",))
    nat = _conn("nat", is_super=True)
    m = ConnectionManager()
    m.active = [prov, nat]

    state = {"fires": [fire("a", "th.r1.p50"), fire("b", "th.r1.p50")]}
    _patch_fires(monkeypatch, state)
    await m.refresh_and_broadcast_deltas()
    for c in m.active:
        c.ws.sent.clear()

    state["fires"] = [fire("a", "th.r1.p50")]              # 'b' gone (resolved/expired)
    await m.refresh_and_broadcast_deltas()

    d = _last(prov.ws)
    assert d["upserts"] == []
    assert d["removes"] == ["b"]


async def test_no_change_sends_nothing(monkeypatch):
    prov = _conn("p50", paths=("th.r1.p50",))
    m = ConnectionManager()
    m.active = [prov]

    state = {"fires": [fire("a", "th.r1.p50")]}
    _patch_fires(monkeypatch, state)
    await m.refresh_and_broadcast_deltas()
    prov.ws.sent.clear()

    await m.refresh_and_broadcast_deltas()                 # identical set
    assert prov.ws.sent == []


async def test_version_increments_per_scope_and_snapshot_carries_it(monkeypatch):
    prov = _conn("p50", paths=("th.r1.p50",))
    m = ConnectionManager()
    m.active = [prov]

    state = {"fires": [fire("a", "th.r1.p50")]}
    _patch_fires(monkeypatch, state)
    await m.refresh_and_broadcast_deltas()                 # v -> 1 (initial upsert)
    state["fires"] = [fire("a", "th.r1.p50", booked=True)]
    await m.refresh_and_broadcast_deltas()                 # v -> 2
    assert m._version[prov.scope_key] == 2

    # a newcomer's snapshot is baselined at the scope's current version
    newcomer = _conn("p50b", paths=("th.r1.p50",))
    m.active.append(newcomer)
    await m.send_snapshot(newcomer)
    snap = _last(newcomer.ws)
    assert snap["type"] == "fires_snapshot"
    assert snap["v"] == 2
    assert [f["id"] for f in snap["fires"]] == ["a"]


async def test_connect_after_change_gets_fresh_snapshot_not_stale_cache(monkeypatch):
    # a change must invalidate the per-scope connect-snapshot cache, or a client
    # connecting within the cache TTL would baseline on stale state at an old
    # version and silently miss the change (deltas only carry the NEXT change)
    prov = _conn("p50", paths=("th.r1.p50",))
    m = ConnectionManager()
    m.active = [prov]
    state = {"fires": [fire("a", "th.r1.p50")]}
    _patch_fires(monkeypatch, state)

    early = FakeWS()
    await m.connect(early, FakeUser("p50e"), ("th.r1.p50",))   # caches snapshot at v=0
    assert _last(early)["v"] == 0

    state["fires"] = [fire("a", "th.r1.p50"), fire("b", "th.r1.p50")]
    await m.refresh_and_broadcast_deltas()                     # v -> 1, cache cleared

    late = FakeWS()
    await m.connect(late, FakeUser("p50l"), ("th.r1.p50",))
    snap = _last(late)
    assert snap["v"] == 1                                      # current version, not the cached 0
    assert sorted(f["id"] for f in snap["fires"]) == ["a", "b"]


async def test_connect_sends_versioned_snapshot_cold_registry(monkeypatch):
    m = ConnectionManager()
    state = {"fires": [fire("a", "th.r1.p50")]}
    _patch_fires(monkeypatch, state)

    ws = FakeWS()
    conn = await m.connect(ws, FakeUser("p50"), ("th.r1.p50",))

    assert ws.accepted
    assert conn in m.active
    snap = _last(ws)
    assert snap["type"] == "fires_snapshot"
    assert snap["v"] == 0                                  # no deltas yet
    assert [f["id"] for f in snap["fires"]] == ["a"]
