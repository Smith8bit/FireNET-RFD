"""WS handlers for booking/unbooking a field officer to a fire.

"Appointing" (admin-initiated) and "booking" (officer self-assigning, not
shown here — see handle_cancel_booking's non-appointed branch) share the same
FieldOfficer.fire_id column, distinguished by the `appointed` flag, which in
turn drives who is allowed to cancel it.
"""

import logging
import uuid

from fastapi import WebSocket
from sqlalchemy import select

from ...database import async_session_maker
from ...database.models import FieldOfficer, Firespot, Region, User, UserRegion
from ...database.schemas import UserRole
from ...db_control.audit import audit
from ...db_control.permission import has_perm, is_admin_user
from ...db_control.push import send_push
from ..manager import Connection
from ._helpers import admin_covers_path

logger = logging.getLogger("firenet.officers")


async def handle_appoint_officer(
    ws: WebSocket,
    admin: User,
    data: dict,
    active_connections: list[Connection],
) -> None:
    """Assign a field officer to an active fire.

    Args:
        ws: The admin's socket.
        admin: Must pass can_manage_officers and cover *both* the fire's
            region and the officer's own registered region — an admin can't
            appoint an officer who's outside their authority even to a fire
            they do control, or vice versa.
        data: Expects {"fire_id": <uuid str>, "officer_id": <uuid str>}.
        active_connections: Unused directly here (appointment doesn't change
            officer rosters), kept for handler signature consistency with
            other officer handlers that do broadcast.

    Edge cases handled:
        - Fire already resolved (`fire.status` set) -> rejected.
        - Fire already booked by a *different* officer -> rejected, unless
          that "different" officer turns out to be the same as `officer_id`
          re-appointing (short-circuited as a no-op success).
        - Officer already holds a *different*, still-unresolved fire -> rejected
          ("officer_busy"); if their held fire is already resolved, treated as
          stale state and overwritten.
        - Concurrent double-booking caught by a DB unique constraint via
          IntegrityError, surfaced as "fire_already_booked" rather than 500ing.
    """
    try:
        fire_id = uuid.UUID(data["fire_id"])
        officer_id = uuid.UUID(data["officer_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_request"})
        return
    notify_user_id = None
    fire_name = None
    async with async_session_maker() as session:
        from ...db_control.permission import can_manage_officers

        if not await can_manage_officers(admin, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        fire = await session.get(Firespot, fire_id)
        if fire is None:
            await ws.send_json({"type": "error", "code": "fire_not_found"})
            return
        if fire.status:
            await ws.send_json({"type": "error", "code": "fire_resolved"})
            return
        fire_path = (
            await session.execute(
                select(Region.path).where(Region.id == fire.region_id)
            )
        ).scalar_one()
        if not await admin_covers_path(admin, fire_path, session):
            await ws.send_json({"type": "error", "code": "out_of_scope"})
            return
        officer = await session.get(FieldOfficer, officer_id)
        if officer is None:
            await ws.send_json({"type": "error", "code": "officer_not_found"})
            return
        officer_path = (
            await session.execute(
                select(Region.path)
                .join(UserRegion, UserRegion.region_id == Region.id)
                .where(
                    UserRegion.user_id == officer.user_id,
                    UserRegion.role == UserRole.FIELD_OFFICER,
                )
            )
        ).scalar_one_or_none()
        if officer_path is None or not await admin_covers_path(
            admin, officer_path, session
        ):
            await ws.send_json({"type": "error", "code": "out_of_scope"})
            return
        if officer.fire_id == fire_id:
            # Already appointed to this exact fire: report success without
            # re-writing state or re-auditing.
            await ws.send_json(
                {
                    "type": "officer_appointed",
                    "fire_id": str(fire_id),
                    "officer_id": str(officer_id),
                }
            )
            return
        holder = (
            await session.execute(
                select(FieldOfficer.id).where(
                    FieldOfficer.fire_id == fire_id, FieldOfficer.id != officer_id
                )
            )
        ).first()
        if holder is not None:
            await ws.send_json({"type": "error", "code": "fire_already_booked"})
            return
        if officer.fire_id is not None:
            held = await session.get(Firespot, officer.fire_id)
            # Only block the re-appointment if the officer's current fire is
            # still open; a resolved fire means their old booking is stale
            # and safe to overwrite.
            if held is not None and not held.status:
                await ws.send_json({"type": "error", "code": "officer_busy"})
                return
        officer.fire_id = fire_id
        officer.appointed = True
        audit(
            session,
            actor=admin,
            action="fire.appoint",
            entity_type="fire",
            entity_id=str(fire_id),
            detail={
                "officer_id": str(officer_id),
                "officer_user_id": str(officer.user_id),
                "name": fire.name,
                "officer_name": officer.name,
            },
        )
        from sqlalchemy.exc import IntegrityError

        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            await ws.send_json({"type": "error", "code": "fire_already_booked"})
            return
        notify_user_id = officer.user_id
        fire_name = fire.name
    if notify_user_id is not None:
        # Push notification uses a fresh session, after commit, so a
        # notification failure can't roll back the appointment itself.
        async with async_session_maker() as session:
            await send_push(
                session,
                notify_user_id,
                title="ได้รับมอบหมายงานใหม่",
                body=f"คุณได้รับมอบหมายให้ดูแลไฟ: {fire_name}",
                data={"type": "fire_appointment", "fire_id": str(fire_id)},
            )
            await session.commit()
    logger.info(
        "fire appointed fire=%s officer=%s by admin=%s", fire_id, officer_id, admin.id
    )
    await ws.send_json(
        {
            "type": "officer_appointed",
            "fire_id": str(fire_id),
            "officer_id": str(officer_id),
        }
    )


async def handle_cancel_booking(
    ws: WebSocket,
    user: User,
    data: dict,
    active_connections: list[Connection],
) -> None:
    """Release a field officer's booking on a fire.

    Permission depends on how the booking was made:
      - If `officer.appointed` (admin-assigned), the caller needs the
        "fire.appoint" permission scoped to the fire's region.
      - Otherwise (officer self-booked), only a general admin can cancel it —
        this path does not let the officer cancel their own self-booking via
        this handler (that would go through a different, officer-facing flow).

    Args:
        ws: The caller's socket.
        user: The acting user (admin or dispatcher with fire.appoint perm).
        data: Expects {"fire_id": <uuid str>}.
        active_connections: Unused here; kept for handler signature parity.
    """
    try:
        fire_id = uuid.UUID(data["fire_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_request"})
        return
    notify_user_id = None
    fire_name = None
    async with async_session_maker() as session:
        officer = (
            await session.execute(
                select(FieldOfficer).where(FieldOfficer.fire_id == fire_id)
            )
        ).scalar_one_or_none()
        if officer is None:
            await ws.send_json({"type": "error", "code": "not_booked"})
            return
        fire = await session.get(Firespot, fire_id)
        fire_name = fire.name if fire is not None else None

        if officer.appointed:
            fire_path = (
                None
                if fire is None
                else (
                    await session.execute(
                        select(Region.path).where(Region.id == fire.region_id)
                    )
                ).scalar_one_or_none()
            )
            if fire_path is None or not await has_perm(
                user, "fire.appoint", fire_path, session
            ):
                await ws.send_json({"type": "error", "code": "forbidden"})
                return
        else:
            if not await is_admin_user(user, session):
                await ws.send_json({"type": "error", "code": "forbidden"})
                return
        notify_user_id = officer.user_id
        officer.fire_id = None
        officer.appointed = False
        audit(
            session,
            actor=user,
            action="fire.cancel_booking",
            entity_type="fire",
            entity_id=str(fire_id),
            detail={
                "officer_id": str(officer.id),
                "officer_user_id": str(officer.user_id),
                "name": fire_name,
                "officer_name": officer.name,
            },
        )
        await session.commit()
    if notify_user_id is not None:
        async with async_session_maker() as session:
            await send_push(
                session,
                notify_user_id,
                title="ยกเลิกการมอบหมายงาน",
                body=(
                    f"การมอบหมายไฟ {fire_name} ถูกยกเลิกแล้ว"
                    if fire_name
                    else "การมอบหมายงานถูกยกเลิกแล้ว"
                ),
                data={"type": "fire_cancelled", "fire_id": str(fire_id)},
            )
            await session.commit()
    logger.info("fire booking cancelled fire=%s by user=%s", fire_id, user.id)
    await ws.send_json({"type": "booking_cancelled", "fire_id": str(fire_id)})
