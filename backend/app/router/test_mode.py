"""
Test mode endpoints: system-wide admin drill on replayed copies of past fires.

Reading the mode is open to every authenticated user (the mobile app shows a banner);
everything else is superuser-only. All logic lives in db_control/test_mode.py.
When TEST_MODE_ALLOWED is false every route here returns 404, so the mode can never
be switched on.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..auth.authen import current_active_user, current_superuser
from ..config import get_settings
from ..database.models import User
from ..database.schemas import TestModeUpdate, TestReplayRequest
from ..db_control import test_mode
from ..db_control.test_mode import TestModeConflict

settings = get_settings()


def _require_allowed() -> None:
    """Router-wide guard for the TEST_MODE_ALLOWED kill switch."""
    if not settings.TEST_MODE_ALLOWED:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")


router = APIRouter(dependencies=[Depends(_require_allowed)])


@router.get("")
async def get_test_mode(user: User = Depends(current_active_user)) -> dict:
    """
    Return the current mode: ``{"enabled", "since", "by"}``.

    Superusers also get ``real_bookings`` — officers holding a real fire, whose jobs
    are hidden while a drill runs — so the console can warn before switching on.
    """
    state = test_mode.test_mode_state()
    if user.is_superuser:
        state["real_bookings"] = await test_mode.real_bookings_count()
    return state


@router.put("")
async def set_test_mode(
    body: TestModeUpdate, user: User = Depends(current_superuser)
) -> dict:
    """Switch Test mode on or off for the whole system (idempotent)."""
    return await test_mode.set_test_mode(user, body.enabled)


@router.get("/days")
async def list_days(
    since: datetime | None = None,
    until: datetime | None = None,
    province: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    _su: User = Depends(current_superuser),
) -> dict:
    """
    Paginated days of real fires (newest first) that can be replayed as a whole.

    Args:
        since/until: Inclusive/exclusive bounds on the fires' ``detected_at``.
        province:    Exact Thai province name; narrows the counts (and the replay).

    Returns:
        ``{"total": int, "items": [...]}``; each day carries its fire count broken
        down by outcome, the number of provinces, and ``replayed`` (copies of that
        day already in the test data).
    """
    return await test_mode.list_replay_days(
        since=since, until=until, province=province, limit=limit, offset=offset
    )


@router.post("/replay")
async def replay(
    body: TestReplayRequest, user: User = Depends(current_superuser)
) -> dict:
    """
    Copy every fire detected on the chosen days (optionally one province) into the
    drill as fresh, open fires.

    Raises:
        HTTPException(409): Test mode is off.
    """
    try:
        replayed = await test_mode.replay_days(user, body.days, body.province)
    except TestModeConflict as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    return {"replayed": replayed}


@router.delete("/data")
async def clear_data(user: User = Depends(current_superuser)) -> dict:
    """
    Reset the running drill: delete every drill fire, resolution, evidence file and
    test audit entry, and drop drill bookings. The drill itself stays on.

    Raises:
        HTTPException(409): Test mode is off.
    """
    try:
        return await test_mode.clear_test_data(user)
    except TestModeConflict as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
