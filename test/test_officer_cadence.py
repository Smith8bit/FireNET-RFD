"""Officer-cadence throttle (pg_listener).

Every field-officer location ping is an UPDATE on field_officers, which fires the
status trigger -> NOTIFY 'field_officers'. Without throttling, 50k officers
pinging every 5 min would drive a full officer-list fanout to every admin at the
0.5s debounce rate. These pin the rule: routine position/status refreshes are
rate-limited to OFFICER_REFRESH_INTERVAL_SECONDS (with a trailing refresh so the
latest positions still land), while bookings and registrations stay prompt.
"""
import asyncio

import app.ws.manager as mgr
import app.ws.officer_handlers as oh
import app.ws.pg_listener as pgl


def _count_refreshes(monkeypatch):
    calls = {"n": 0, "pending": 0}

    async def fake_refresh(active, include_pending=False):
        calls["n"] += 1
        if include_pending:
            calls["pending"] += 1

    monkeypatch.setattr(oh, "broadcast_admin_refresh", fake_refresh)
    return calls


async def test_routine_position_pings_are_rate_limited(monkeypatch):
    calls = _count_refreshes(monkeypatch)
    monkeypatch.setattr(mgr.manager, "active", [object()])      # one connected admin
    monkeypatch.setattr(pgl.settings, "OFFICER_REFRESH_INTERVAL_SECONDS", 0.3)
    lis = pgl.PgListener()

    await lis._maybe_refresh_officers()           # first routine refresh fires now
    assert calls["n"] == 1
    await lis._maybe_refresh_officers()           # a burst of pings during cooldown...
    await lis._maybe_refresh_officers()
    assert calls["n"] == 1                        # ...does not re-fan the fleet
    await asyncio.sleep(0.45)                     # one trailing refresh after the window
    assert calls["n"] == 2
    await lis.stop()


async def test_booking_and_registration_refresh_promptly(monkeypatch):
    calls = _count_refreshes(monkeypatch)
    monkeypatch.setattr(mgr.manager, "active", [object()])
    monkeypatch.setattr(pgl.settings, "OFFICER_REFRESH_INTERVAL_SECONDS", 60)
    lis = pgl.PgListener()

    await lis._refresh_officers(include_pending=False)   # a booking (busy flag changed)
    await lis._refresh_officers(include_pending=True)    # a registration (pending list)
    assert calls["n"] == 2                               # never throttled
    assert calls["pending"] == 1


async def test_no_fanout_when_no_admins_connected(monkeypatch):
    calls = _count_refreshes(monkeypatch)
    monkeypatch.setattr(mgr.manager, "active", [])        # nobody connected
    lis = pgl.PgListener()

    await lis._refresh_officers()
    await lis._maybe_refresh_officers()
    assert calls["n"] == 0
