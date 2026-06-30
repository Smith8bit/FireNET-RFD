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

_LOCATION_POLL_KEY = "location_poll_minutes"


def _effective_poll_minutes(raw: str | None) -> float:
    """Clamp the stored (or default) poll cadence to the configured [MIN, MAX] window.

    ponytail: floor and ceiling kept 1 min apart (1–10 min) so a late Doze tick
    still beats the 20-min officer TTL — see LOCATION_POLL_MAX_MINUTES in config.
    """
    minutes = float(raw) if raw is not None else settings.LOCATION_POLL_DEFAULT_MINUTES
    return min(max(minutes, settings.LOCATION_POLL_MIN_MINUTES), settings.LOCATION_POLL_MAX_MINUTES)


async def _location_poll_minutes(session: AsyncSession) -> float:
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
    return {"minutes": await _location_poll_minutes(session)}


@router.patch("/location-poll-interval", status_code=status.HTTP_200_OK)
async def set_location_poll_interval(
    body: LocationPollUpdate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict[str, float]:
    if not user.is_superuser:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "superuser only")
    # store raw value (read-time clamping preserves intent if MIN/MAX ever change),
    # but audit + return the effective value so the trail matches what officers get
    effective = _effective_poll_minutes(str(body.minutes))
    await session.execute(
        insert(AppSetting)
        .values(key=_LOCATION_POLL_KEY, value=str(body.minutes))
        .on_conflict_do_update(index_elements=["key"], set_={"value": str(body.minutes)})
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
