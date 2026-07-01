"""
Fire booking (reserve/release) and leaderboard endpoints for field officers.

An officer can self-assign (reserve) one active fire at a time. Dispatcher-appointed
fires cannot be self-cancelled — only a dispatcher may release them — to ensure
command intent is respected. The leaderboard ranks monthly resolved fires within
the officer's region subtree.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ...auth.authen import current_active_user
from ...database import get_async_session
from ...database.models import (
    FieldOfficer,
    FireResolution,
    Firespot,
    Region,
    User,
    UserRegion,
)
from ...database.schemas import FireAssign, UserRole
from ...db_control.audit import audit
from ...db_control.fires import FireDetail, build_fire_detail
from ...db_control.permission import fire_visible, user_region_paths
from ._helpers import get_field_officer

router = APIRouter()

# Leaderboard capped at 50 to keep the response payload predictable.
_LEADERBOARD_LIMIT = 50


@router.patch("/me/fire", status_code=status.HTTP_200_OK)
async def reserve_fire(
    body: FireAssign,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> FireDetail | None:
    """
    Assign or release the calling officer's fire booking.

    Setting `body.fire_id` to a UUID books that fire; setting it to None releases
    the current booking. The endpoint enforces a multi-step state machine:

    Release rules:
      - Appointed fires (dispatcher-assigned) cannot be self-released.

    Booking rules:
      - Officer must be active (online).
      - Target fire must exist, be in the officer's visible region, and be unresolved.
      - Officer must not already hold a different unresolved fire.
      - Fire must not be reserved by another officer.

    Race condition: a DB unique constraint on (fire_id) at the DB level is the
    final arbiter; IntegrityError on commit is caught and surfaced as 409.

    Args:
        body:    FireAssign schema with optional `fire_id` (UUID or None).
        user:    Authenticated field officer.
        session: Async DB session.

    Returns:
        FireDetail of the newly booked fire, or None on release.

    Raises:
        HTTPException(403): Appointed fire self-cancel attempt, or out-of-region.
        HTTPException(404): Fire not found.
        HTTPException(409): Officer offline, fire resolved, officer double-booked, or race condition.
    """
    fo = await get_field_officer(user, session)
    fire = None
    # Block self-cancel when a dispatcher explicitly appointed this officer.
    if body.fire_id is None and fo.fire_id is not None and fo.appointed:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "appointed fire, dispatcher-only cancel"
        )
    if body.fire_id is not None:
        if not fo.active:
            raise HTTPException(status.HTTP_409_CONFLICT, "officer offline")
        fire = await session.get(Firespot, body.fire_id)
        if fire is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "fire not found")
        region_path = (
            await session.execute(
                select(Region.path).where(Region.id == fire.region_id)
            )
        ).scalar_one()
        if not await fire_visible(user, str(region_path), session):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "fire outside your assigned region"
            )
        if fire.status:
            raise HTTPException(status.HTTP_409_CONFLICT, "fire already resolved")
        # Allow re-booking the same fire (idempotent), but block holding two different fires.
        if fo.fire_id is not None and fo.fire_id != body.fire_id:
            held = await session.get(Firespot, fo.fire_id)
            if held is not None and not held.status:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "officer already holds an unresolved fire"
                )
        holder = (
            await session.execute(
                select(FieldOfficer.id).where(
                    FieldOfficer.fire_id == body.fire_id, FieldOfficer.id != fo.id
                )
            )
        ).first()
        if holder is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "fire already reserved")
    previous_fire_id = fo.fire_id
    fo.fire_id = body.fire_id
    fo.appointed = False  # Booking via this endpoint is always a self-assignment.
    if body.fire_id is not None:
        if body.fire_id != previous_fire_id:
            audit(
                session,
                actor=user,
                action="fire.reserve",
                entity_type="fire",
                entity_id=str(fire.id),
                detail={"name": fire.name},
            )
    elif previous_fire_id is not None:
        released = await session.get(Firespot, previous_fire_id)
        audit(
            session,
            actor=user,
            action="fire.release",
            entity_type="fire",
            entity_id=str(previous_fire_id),
            detail={"name": released.name} if released is not None else None,
        )
    try:
        await session.commit()
    except IntegrityError:
        # DB unique constraint fired — another officer booked this fire between our check and commit.
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "fire already reserved")
    return build_fire_detail(fire) if fire is not None else None


@router.get("/me/fire")
async def my_reserved_fire(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> FireDetail | None:
    """
    Return the fire currently booked by the calling officer.

    Args:
        user:    Authenticated field officer.
        session: Async DB session.

    Returns:
        FireDetail with `appointed` flag set if a dispatcher booked this fire, or None.
    """
    fo = await get_field_officer(user, session)
    if fo.fire_id is None:
        return None
    fire = await session.get(Firespot, fo.fire_id)
    return build_fire_detail(fire, appointed=fo.appointed) if fire is not None else None


@router.get("/me/leaderboard")
async def my_leaderboard(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict:
    """
    Return the current month's fire-resolution leaderboard for the officer's region.

    Only confirmed resolutions (not false alarms) count toward the ranking.
    Superusers see a global leaderboard; others are filtered to their region subtree
    via the same ltree `<@` descent check used elsewhere.

    Args:
        user:    Authenticated field officer.
        session: Async DB session.

    Returns:
        {
            "month": "YYYY-MM-DD",   # first day of current month
            "items": [{"rank": int, "name": str, "count": int, "is_me": bool}, ...]
        }
    """
    fo = await get_field_officer(user, session)
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    stmt = (
        select(
            FieldOfficer.id,
            FieldOfficer.name,
            func.count(FireResolution.id).label("cnt"),
        )
        .join(FireResolution, FireResolution.officer_id == FieldOfficer.id)
        .join(Firespot, Firespot.id == FireResolution.fire_id)
        .join(
            UserRegion,
            (UserRegion.user_id == FieldOfficer.user_id)
            & (UserRegion.role == UserRole.FIELD_OFFICER),
        )
        .join(Region, Region.id == UserRegion.region_id)
        .where(
            Firespot.false_alarm.is_(False), FireResolution.created_at >= month_start
        )
        .group_by(FieldOfficer.id, FieldOfficer.name)
        .order_by(func.count(FireResolution.id).desc())
        .limit(_LEADERBOARD_LIMIT)
    )
    if not user.is_superuser:
        paths = await user_region_paths(user, session)
        if not paths:
            return {"month": month_start.date().isoformat(), "items": []}
        stmt = stmt.where(or_(*[Region.path.op("<@")(p) for p in paths]))
    rows = (await session.execute(stmt)).all()
    return {
        "month": month_start.date().isoformat(),
        "items": [
            {"rank": i + 1, "name": name or "—", "count": cnt, "is_me": fid == fo.id}
            for i, (fid, name, cnt) in enumerate(rows)
        ],
    }
