"""
Field officer profile and status/location endpoints.

Location updates are high-frequency (mobile heartbeat) and intentionally unaudited —
logging every GPS ping would flood the audit log. Only online/offline state transitions
are written to the audit log because they represent meaningful operational events.

Name is stored in two places (UserRegion.name and FieldOfficer.name) because each
table is queried independently in different contexts (leaderboard vs live map). Both
are updated atomically here to keep them in sync.
"""

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
    """
    Update the officer's GPS coordinates and/or active status.

    GPS coordinates are converted from decimal degrees to a PostGIS Point geometry
    using SRID 4326 (WGS-84), matching the coordinate system of fire hotspot data.
    Note: GeoAlchemy2 `from_shape` expects (longitude, latitude) — not (lat, lng).

    Status changes (online ↔ offline) are audited; location changes are not.

    Args:
        body:    OfficerStatusUpdate with optional `latitude`, `longitude`, and `active`.
        user:    Authenticated field officer.
        session: Async DB session.

    Returns:
        {"active": bool, "last_updated": ISO-8601 timestamp string}
    """
    fo = await get_field_officer(user, session)
    if body.latitude is not None and body.longitude is not None:
        # GeoAlchemy2 convention: Point(x=longitude, y=latitude)
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
    """
    Return the officer's current active status and last heartbeat timestamp.

    Args:
        user:    Authenticated field officer.
        session: Async DB session.

    Returns:
        {"active": bool, "last_updated": ISO-8601 string or None if never updated}
    """
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
    """
    Update the officer's display name and optional division.

    Name is written to both `UserRegion` (shown in admin views) and `FieldOfficer`
    (shown in leaderboard and resolution history) because the two models are queried
    independently and there is no join at read time. An empty-after-strip name is
    rejected to prevent blank display names in the UI.

    Division is stored on the User model (not FieldOfficer) because it is shared
    across all roles a user might hold. Passing an empty string clears it to None.

    Args:
        body:    OfficerProfileUpdate with `name` (required) and optional `division`.
        user:    Authenticated field officer.
        session: Async DB session.

    Returns:
        {"name": str, "division": str | None}

    Raises:
        HTTPException(400): Name is blank after stripping whitespace.
        HTTPException(404): No field officer UserRegion record found.
    """
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
    # Bulk update FieldOfficer.name to keep it in sync with UserRegion.name.
    await session.execute(
        update(FieldOfficer).where(FieldOfficer.user_id == user.id).values(name=name)
    )
    if body.division is not None:
        user.division = body.division.strip() or None
    await session.commit()
    return {"name": name, "division": user.division}
