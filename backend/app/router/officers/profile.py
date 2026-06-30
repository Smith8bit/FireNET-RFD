from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ...auth.authen import current_active_user
from ...database import get_async_session
from ...database.models import FieldOfficer, User, UserRegion
from ...database.schemas import OfficerProfileUpdate, OfficerStatusUpdate, UserRole
from ...db_control.audit import audit
from ._helpers import get_field_officer

router = APIRouter()


@router.patch("/me/location", status_code=status.HTTP_200_OK)
async def update_my_location(
    body: OfficerStatusUpdate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict[str, bool | str | None]:
    fo = await get_field_officer(user, session)
    if body.latitude is not None and body.longitude is not None:
        fo.last_location = from_shape(Point(body.longitude, body.latitude), srid=4326)
    if body.active is not None:
        if body.active != fo.active:
            audit(
                session,
                actor=user,
                action="officer.online" if body.active else "officer.offline",
                entity_type="officer",
                entity_id=str(fo.id),
            )
        fo.active = body.active
    fo.last_updated = datetime.now(timezone.utc)
    await session.commit()
    return {"active": fo.active, "last_updated": fo.last_updated.isoformat()}


@router.get("/me/status")
async def my_status(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict[str, bool | str | None]:
    fo = await get_field_officer(user, session)
    return {
        "active": fo.active,
        "last_updated": fo.last_updated.isoformat() if fo.last_updated else None,
    }


@router.patch("/me/profile", status_code=status.HTTP_200_OK)
async def update_my_profile(
    body: OfficerProfileUpdate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict[str, str | None]:
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "name required")
    ur = (
        await session.execute(
            select(UserRegion).where(
                UserRegion.user_id == user.id,
                UserRegion.role == UserRole.FIELD_OFFICER,
            )
        )
    ).scalar_one_or_none()
    if ur is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field officer record not found")
    ur.name = name
    await session.execute(
        update(FieldOfficer).where(FieldOfficer.user_id == user.id).values(name=name)
    )
    if body.division is not None:
        user.division = body.division.strip() or None
    await session.commit()
    return {"name": name, "division": user.division}
