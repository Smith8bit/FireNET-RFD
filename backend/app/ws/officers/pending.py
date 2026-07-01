"""WS handlers for the field-officer verification queue.

New field officers self-register (see router/officers/registration.py) but
stay unverified until an admin approves them here; verification also creates
their FieldOfficer row, which is the record actually used for dispatch/booking.
"""

import logging
import uuid

from fastapi import WebSocket

from ...database import async_session_maker
from ...database.models import FieldOfficer, User
from ...db_control.audit import audit
from ...db_control.officers import fetch_pending
from ...db_control.permission import can_manage_officers, has_perm_anywhere
from ..manager import Connection
from ._helpers import (
    admin_covers_path,
    broadcast_admin_refresh,
    broadcast_officers_update,
)

logger = logging.getLogger("firenet.officers")


async def handle_list_pending(ws: WebSocket, user: User) -> None:
    """Send the caller their region-scoped list of unverified field officers.

    Args:
        ws: The requesting client's socket.
        user: Authenticated caller; must hold "officers.view" in at least
            one region or the request is rejected.
    """
    async with async_session_maker() as session:
        if not await has_perm_anywhere(user, "officers.view", session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        officers = await fetch_pending(session, user)
    await ws.send_json({"type": "pending_officers", "officers": officers})


async def handle_verify_officer(
    ws: WebSocket,
    admin: User,
    data: dict,
    active_connections: list[Connection],
) -> None:
    """Approve a pending field officer, creating their FieldOfficer record.

    Args:
        ws: The admin's socket, used to report validation/permission errors.
        admin: The acting admin; must pass can_manage_officers and cover the
            officer's registered province.
        data: Client payload; expects {"user_id": <uuid str>}.
        active_connections: All live sockets, used to broadcast the resulting
            change to every other officer-viewing connection.

    Idempotency: if a FieldOfficer row already exists for this user (e.g. a
    duplicate verify request), verification still succeeds without creating
    a second row.
    """
    try:
        user_id = uuid.UUID(data["user_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_user_id"})
        return
    # Imported locally to avoid pulling these models into every module that
    # imports this handler file.
    from sqlalchemy import select
    from ...database.models import Region, UserRegion

    async with async_session_maker() as session:
        if not await can_manage_officers(admin, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        ur_row = (
            await session.execute(
                select(Region.path, UserRegion.name)
                .join(UserRegion, UserRegion.region_id == Region.id)
                .where(
                    UserRegion.user_id == user_id, UserRegion.role == "field_officer"
                )
            )
        ).one_or_none()
        if ur_row is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        province_path, officer_name = ur_row

        # Scope check happens *after* confirming the target exists, so a
        # not-found user never leaks region info via a different error code.
        if not await admin_covers_path(admin, province_path, session):
            await ws.send_json({"type": "error", "code": "out_of_scope"})
            return
        from ...database.models import User as UserModel

        target = await session.get(UserModel, user_id)
        if target is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        target.is_verified = True

        existing_fo = (
            await session.execute(
                select(FieldOfficer).where(FieldOfficer.user_id == user_id)
            )
        ).scalar_one_or_none()
        if existing_fo is None:
            session.add(FieldOfficer(user_id=user_id, name=officer_name))
            logger.info("created FieldOfficer user=%s", user_id)
        else:
            logger.info("FieldOfficer already exists user=%s", user_id)
        audit(
            session,
            actor=admin,
            action="officer.verify",
            entity_type="officer",
            entity_id=str(user_id),
            detail={
                "username": target.email,
                "name": officer_name,
                "division": target.division,
                "province_path": str(province_path),
            },
        )
        await session.commit()
    logger.info("officer verified user=%s by admin=%s", user_id, admin.id)
    await ws.send_json({"type": "officer_verified", "user_id": str(user_id)})
    # Verification changes who shows up in officers_in_region for every admin
    # scoped to this province, so refresh everyone, not just the caller.
    await broadcast_officers_update(active_connections)
