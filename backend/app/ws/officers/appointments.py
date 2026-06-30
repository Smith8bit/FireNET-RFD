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
    """Admin appoints a fire to a specific field officer.

    Same first-come-first-served invariants apply as self-reserve: a fire is
    held by at most one officer, an officer holds at most one unresolved fire.
    On success the officer is notified via FCM.
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
            await session.execute(select(Region.path).where(Region.id == fire.region_id))
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
        if officer_path is None or not await admin_covers_path(admin, officer_path, session):
            await ws.send_json({"type": "error", "code": "out_of_scope"})
            return

        # idempotent if the officer already holds this fire
        if officer.fire_id == fire_id:
            await ws.send_json(
                {"type": "officer_appointed", "fire_id": str(fire_id), "officer_id": str(officer_id)}
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
            if held is not None and not held.status:
                await ws.send_json({"type": "error", "code": "officer_busy"})
                return

        officer.fire_id = fire_id
        officer.appointed = True  # dispatcher-assigned vs. self-reserved
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

    # push is best-effort and runs outside the appointment transaction
    if notify_user_id is not None:
        async with async_session_maker() as session:
            await send_push(
                session,
                notify_user_id,
                title="ได้รับมอบหมายงานใหม่",
                body=f"คุณได้รับมอบหมายให้ดูแลไฟ: {fire_name}",
                data={"type": "fire_appointment", "fire_id": str(fire_id)},
            )
            await session.commit()

    logger.info("fire appointed fire=%s officer=%s by admin=%s", fire_id, officer_id, admin.id)
    await ws.send_json(
        {"type": "officer_appointed", "fire_id": str(fire_id), "officer_id": str(officer_id)}
    )


async def handle_cancel_booking(
    ws: WebSocket,
    user: User,
    data: dict,
    active_connections: list[Connection],
) -> None:
    """Release a held fire from its officer.

    Who may cancel depends on how it was booked:
      - self-reserved: any console user.
      - dispatcher-appointed: only fire.appoint, scoped to the fire's region.
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
            # dispatcher-appointed: needs fire.appoint within the fire's region
            fire_path = None if fire is None else (
                await session.execute(
                    select(Region.path).where(Region.id == fire.region_id)
                )
            ).scalar_one_or_none()
            if fire_path is None or not await has_perm(user, "fire.appoint", fire_path, session):
                await ws.send_json({"type": "error", "code": "forbidden"})
                return
        else:
            # self-reserved: anyone with console access may cancel
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
