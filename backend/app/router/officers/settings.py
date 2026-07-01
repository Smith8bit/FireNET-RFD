"""
App-wide settings endpoints — currently limited to the officer location poll interval.

The poll interval controls how frequently the mobile app sends GPS heartbeats.
It is stored in the `AppSetting` key-value table so it can be changed at runtime
without a redeploy. The effective value is always clamped to configured bounds,
even if the DB row contains an out-of-range value from a previous configuration.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ...auth.authen import current_active_user
from ...config import get_settings
from ...database import get_async_session
from ...database.models import AppSetting, User
from ...database.schemas import LocationPollUpdate
from ...db_control.audit import audit

settings = get_settings()
router = APIRouter()

# Key used to look up the poll interval in the AppSetting KV table.
_LOCATION_POLL_KEY = "location_poll_minutes"


def _effective_poll_minutes(raw: str | None) -> float:
    """
    Parse and clamp the raw DB value to the configured min/max range.

    Falls back to `settings.LOCATION_POLL_DEFAULT_MINUTES` if no DB row exists.
    Clamping is applied at read time so that if the bounds change in config, all
    clients automatically receive a value within the new range on the next request.

    Args:
        raw: String value from AppSetting, or None if no row is set.

    Returns:
        Effective poll interval in minutes, within [LOCATION_POLL_MIN_MINUTES, LOCATION_POLL_MAX_MINUTES].
    """
    minutes = float(raw) if raw is not None else settings.LOCATION_POLL_DEFAULT_MINUTES
    return min(
        max(minutes, settings.LOCATION_POLL_MIN_MINUTES),
        settings.LOCATION_POLL_MAX_MINUTES,
    )


async def _location_poll_minutes(session: AsyncSession) -> float:
    """
    Fetch the current poll interval from the DB, applying clamp via _effective_poll_minutes.

    Args:
        session: Async DB session.

    Returns:
        Effective poll interval in minutes.
    """
    raw = (
        await session.execute(
            select(AppSetting.value).where(AppSetting.key == _LOCATION_POLL_KEY)
        )
    ).scalar_one_or_none()
    return _effective_poll_minutes(raw)


@router.get("/location-poll-interval")
async def get_location_poll_interval(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict[str, float]:
    """
    Return the current GPS heartbeat interval for officer apps.

    Available to all authenticated users so the mobile app can read it at startup.

    Args:
        user:    Authenticated user (any role).
        session: Async DB session.

    Returns:
        {"minutes": float}
    """
    return {"minutes": await _location_poll_minutes(session)}


@router.patch("/location-poll-interval", status_code=status.HTTP_200_OK)
async def set_location_poll_interval(
    body: LocationPollUpdate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict[str, float]:
    """
    Update the GPS heartbeat interval — superuser only.

    The superuser check is inline rather than via a `current_superuser` dependency
    because this endpoint is also accessible to non-superusers for reads (GET above).
    Using the same `current_active_user` dep keeps the routes symmetrical.

    Uses an upsert so the first call inserts and subsequent calls update in place,
    without requiring a pre-existing AppSetting row.

    Args:
        body:    LocationPollUpdate with `minutes` (float) for the new interval.
        user:    Authenticated user; must be a superuser to mutate.
        session: Async DB session.

    Returns:
        {"minutes": float} — the effective (clamped) value that was stored.

    Raises:
        HTTPException(403): Caller is not a superuser.
    """
    if not user.is_superuser:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "superuser only")
    effective = _effective_poll_minutes(str(body.minutes))
    await session.execute(
        insert(AppSetting)
        .values(key=_LOCATION_POLL_KEY, value=str(body.minutes))
        .on_conflict_do_update(
            index_elements=["key"], set_={"value": str(body.minutes)}
        )
    )
    audit(
        session,
        actor=user,
        action="settings.location_poll",
        entity_type="settings",
        entity_id=_LOCATION_POLL_KEY,
        detail={"minutes": effective},
    )
    await session.commit()
    return {"minutes": effective}
