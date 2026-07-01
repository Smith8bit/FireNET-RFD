"""WS handlers for field-officer self-service region transfer requests.

A field officer asks to move to a different province (see
router/officers/region_change.py); an admin here approves or rejects it. On
approval the officer's UserRegion is actually moved and they're notified via
push; on rejection only the request record changes.
"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import WebSocket
from sqlalchemy import select

from ...database import async_session_maker
from ...database.models import Region, RegionChangeRequest, User, UserRegion
from ...database.schemas import UserRole
from ...db_control.audit import audit
from ...db_control.officers import fetch_region_requests
from ...db_control.permission import (
    can_manage_officers,
    is_admin_user,
    update_user_region,
)
from ...db_control.push import send_push
from ..manager import Connection
from ._helpers import admin_covers_path, broadcast_admin_refresh

logger = logging.getLogger("firenet.officers")


async def handle_list_region_requests(ws: WebSocket, user: User) -> None:
    """Send the caller their region-scoped list of pending transfer requests."""
    async with async_session_maker() as session:
        if not await is_admin_user(user, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        requests = await fetch_region_requests(session, user)
    await ws.send_json({"type": "region_change_requests", "requests": requests})


async def handle_decide_region_request(
    ws: WebSocket,
    admin: User,
    data: dict,
    active_connections: list[Connection],
) -> None:
    """Approve or reject a pending region-change request.

    Args:
        ws: The deciding admin's socket.
        admin: Must pass can_manage_officers and cover the *destination*
            region (not the officer's current region) to approve/reject.
        data: Expects {"request_id": <uuid str>, "action": "approve"|"reject"}.
        active_connections: Used to refresh every admin's officer list when
            an approval actually moves the officer.

    Notes:
        - The request row's status is only mutated after all validation
          passes and the region move (if any) succeeds within the same
          transaction, so a failed commit can't leave the request half-decided.
        - A push notification is sent in a *separate* session, after the
          decision has been committed, so a notification-delivery hiccup
          never rolls back the actual decision.
    """
    try:
        request_id = uuid.UUID(data["request_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_request"})
        return
    action = data.get("action")
    if action not in ("approve", "reject"):
        await ws.send_json({"type": "error", "code": "invalid_action"})
        return
    async with async_session_maker() as session:
        if not await can_manage_officers(admin, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        req = await session.get(RegionChangeRequest, request_id)
        if req is None or req.status != "pending":
            # Reusing "not_found" for an already-decided request avoids a
            # separate race-condition error code for double-submits.
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        dest = await session.get(Region, req.requested_region_id)
        if dest is None:
            await ws.send_json({"type": "error", "code": "invalid_region"})
            return
        if not await admin_covers_path(admin, dest.path, session):
            await ws.send_json({"type": "error", "code": "out_of_scope"})
            return
        ur = (
            await session.execute(
                select(UserRegion).where(
                    UserRegion.user_id == req.user_id,
                    UserRegion.role == UserRole.FIELD_OFFICER,
                )
            )
        ).scalar_one_or_none()
        if ur is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        old_region_id = ur.region_id
        if action == "approve":
            # Only actually move the officer's region on approval; a reject
            # leaves their current UserRegion untouched.
            await update_user_region(
                session,
                user_id=req.user_id,
                old_region_id=old_region_id,
                ur_obj=ur,
                region_id=dest.id,
            )
        req.status = "approved" if action == "approve" else "rejected"
        req.decided_at = datetime.now(timezone.utc)
        req.decided_by = admin.id

        officer_name = (
            await session.execute(
                select(UserRegion.name).where(
                    UserRegion.user_id == req.user_id,
                    UserRegion.role == UserRole.FIELD_OFFICER,
                )
            )
        ).scalar_one_or_none()
        # Captured before update_user_region's move for the audit trail's
        # "previous" value; old_region_id is fixed above the branch.
        prev_path = (
            await session.execute(select(Region.path).where(Region.id == old_region_id))
        ).scalar_one_or_none()
        detail = {
            "request_id": str(req.id),
            "province_path": str(dest.path),
            "officer_name": officer_name,
            "previous_province_path": str(prev_path) if prev_path is not None else None,
        }
        audit(
            session,
            actor=admin,
            action=f"region_change.{req.status}",
            entity_type="user",
            entity_id=str(req.user_id),
            detail=detail,
        )
        from sqlalchemy.exc import IntegrityError

        try:
            await session.commit()
        except IntegrityError:
            # e.g. a concurrent decision or region move produced a conflicting
            # unique constraint; surface as a generic conflict rather than crash.
            await session.rollback()
            await ws.send_json({"type": "error", "code": "conflict"})
            return
        # Snapshot values needed after the session closes, since ORM objects
        # become unusable once their session ends.
        notify_user_id = req.user_id
        decided_status = req.status
        province_name = dest.name_th
    approved = decided_status == "approved"
    async with async_session_maker() as session:
        await send_push(
            session,
            notify_user_id,
            title="อนุมัติคำขอย้ายพื้นที่" if approved else "ปฏิเสธคำขอย้ายพื้นที่",
            body=(
                f"คำขอย้ายไปยัง {province_name} ได้รับการอนุมัติแล้ว"
                if approved
                else f"คำขอย้ายไปยัง {province_name} ถูกปฏิเสธ"
            ),
            data={"type": "region_change", "status": decided_status},
        )
        await session.commit()
    logger.info(
        "region request %s %s by admin=%s", request_id, decided_status, admin.id
    )
    await ws.send_json(
        {
            "type": "region_request_decided",
            "request_id": str(request_id),
            "status": decided_status,
        }
    )
    # Refresh the caller's own request list immediately...
    await handle_list_region_requests(ws, admin)
    if action == "approve":
        # ...and, only on approval (since only that changes officer rosters),
        # push updated officer + pending lists to every other admin connection.
        await broadcast_admin_refresh(active_connections, include_pending=True)
