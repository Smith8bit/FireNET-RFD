"""WS handlers for admin CRUD over already-verified field officers.

Complements pending.py (verification) and region_requests.py (self-service
transfers): this module covers an admin directly editing, relocating, or
removing an officer's profile.
"""

import logging
import uuid

from fastapi import WebSocket
from fastapi_users.password import PasswordHelper
from sqlalchemy import delete, select, update

from ...database import async_session_maker
from ...database.models import FieldOfficer, Region, User, UserRegion
from ...database.schemas import UserRole, valid_username
from ...db_control.audit import audit
from ...db_control.officers import OfficerRow, fetch_officers
from ...db_control.permission import (
    can_manage_officers,
    has_perm_anywhere,
    update_user_region,
)
from ..manager import Connection
from ._helpers import admin_covers_path, broadcast_admin_refresh, map_subset

logger = logging.getLogger("firenet.officers")
_password_helper = PasswordHelper()
_MIN_PASSWORD_LEN = 8


async def handle_list_officers(ws: WebSocket, user: User) -> None:
    """Send the caller their region-scoped list of verified officers (full detail)."""
    async with async_session_maker() as session:
        if not await has_perm_anywhere(user, "officers.view", session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        officers = await fetch_officers(session, user)
    logger.info("list_officers user=%s count=%d", user.id, len(officers))
    await ws.send_json({"type": "officers_in_region", "officers": officers})


async def handle_list_officers_MAP(ws: WebSocket, user: User) -> None:
    """Same as handle_list_officers but trimmed to map-display fields (map_subset)."""
    async with async_session_maker() as session:
        if not await has_perm_anywhere(user, "officers.view", session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        officers = await fetch_officers(session, user)
    logger.info("list_officers_MAP user=%s count=%d", user.id, len(officers))
    await ws.send_json({"type": "officers_map", "officers": map_subset(officers)})


async def handle_update_officer(
    ws: WebSocket,
    admin: User,
    data: dict,
    active_connections: list[Connection],
) -> None:
    """Update an officer's name, province, username, division, and/or password.

    Args:
        ws: The admin's socket.
        admin: Must pass can_manage_officers and cover the officer's
            *current* province; if relocating, must also cover the
            *destination* province.
        data: Partial-update payload; only keys present are considered (e.g.
            omitting "division" leaves it untouched, but passing
            "division": "" clears it — see the `"division" in data` checks).
        active_connections: Used to broadcast the change to every
            officer-viewing connection once the update is committed.

    All fields are optional but at least one real change is required
    (`nothing_to_update` otherwise). Every field is independently validated
    before any DB write is attempted, so a rejected update never partially
    applies.
    """
    try:
        user_id = uuid.UUID(data["user_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_user_id"})
        return
    new_name = (data.get("name") or "").strip() or None if "name" in data else None
    province_code = (data.get("province_code") or "").strip() or None
    new_username = (
        ((data.get("username") or "").strip() or None) if "username" in data else None
    )
    new_password = data.get("password") or None
    new_division = (
        ((data.get("division") or "").strip() or None) if "division" in data else None
    )

    if (
        new_name is None
        and province_code is None
        and new_username is None
        and new_password is None
        and "division" not in data
    ):
        await ws.send_json({"type": "error", "code": "nothing_to_update"})
        return
    if new_username is not None and not valid_username(new_username):
        await ws.send_json({"type": "error", "code": "invalid_username"})
        return
    if new_password is not None and len(new_password) < _MIN_PASSWORD_LEN:
        await ws.send_json({"type": "error", "code": "weak_password"})
        return
    async with async_session_maker() as session:
        if not await can_manage_officers(admin, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        ur_row = (
            await session.execute(
                select(UserRegion, Region.path)
                .join(Region, Region.id == UserRegion.region_id)
                .where(
                    UserRegion.user_id == user_id,
                    UserRegion.role == UserRole.FIELD_OFFICER,
                )
            )
        ).one_or_none()
        if ur_row is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        user_region, current_path = ur_row

        if not await admin_covers_path(admin, current_path, session):
            await ws.send_json({"type": "error", "code": "out_of_scope"})
            return
        target = await session.get(User, user_id)
        if target is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        # `changes` accumulates a human-readable audit trail; `ur_values`
        # accumulates only the fields that actually need writing to
        # UserRegion (passed as **kwargs to update_user_region below).
        changes: dict = {}
        ur_values: dict = {}
        if new_name is not None and new_name != user_region.name:
            changes["name"] = new_name
            changes["previous_name"] = user_region.name
            ur_values["name"] = new_name
        if province_code is not None:
            province = (
                await session.execute(
                    select(Region).where(
                        Region.code == province_code, Region.level == "province"
                    )
                )
            ).scalar_one_or_none()
            if province is None:
                await ws.send_json({"type": "error", "code": "invalid_province"})
                return
            if province.id != user_region.region_id:
                # Only re-check scope and record a change if this is an
                # actual relocation, not a no-op resubmission of the current province.
                if not await admin_covers_path(admin, province.path, session):
                    await ws.send_json({"type": "error", "code": "out_of_scope"})
                    return
                changes["province_path"] = str(province.path)
                changes["previous_province_path"] = str(current_path)
                ur_values["region_id"] = province.id
        if new_username is not None and new_username != target.email:
            changes["username"] = new_username
            changes["previous_username"] = target.email
            target.email = new_username
        if "division" in data and new_division != target.division:
            changes["division"] = new_division
            changes["previous_division"] = target.division
            target.division = new_division
        if new_password is not None:
            target.hashed_password = _password_helper.hash(new_password)
            changes["password_changed"] = True
            changes["officer_name"] = new_name or user_region.name or target.email
        if not changes:
            # All requested values matched existing state; report success
            # without writing or auditing anything.
            await ws.send_json({"type": "officer_updated", "user_id": str(user_id)})
            return
        if ur_values:
            await update_user_region(
                session,
                user_id=user_id,
                old_region_id=user_region.region_id,
                ur_obj=user_region,
                **ur_values,
            )
            if "name" in ur_values:
                # FieldOfficer.name is denormalized from UserRegion.name for
                # dispatch/map display; keep it in sync on rename.
                await session.execute(
                    update(FieldOfficer)
                    .where(FieldOfficer.user_id == user_id)
                    .values(name=new_name)
                )
        audit(
            session,
            actor=admin,
            action="officer.update",
            entity_type="officer",
            entity_id=str(user_id),
            detail=changes,
        )
        from sqlalchemy.exc import IntegrityError

        try:
            await session.commit()
        except IntegrityError:
            # Most likely a duplicate email/username from a concurrent request.
            await session.rollback()
            await ws.send_json({"type": "error", "code": "username_taken"})
            return
    logger.info(
        "officer updated user=%s by admin=%s changes=%s",
        user_id,
        admin.id,
        sorted(changes),
    )
    await ws.send_json({"type": "officer_updated", "user_id": str(user_id)})
    await broadcast_admin_refresh(active_connections, include_pending=True)


async def handle_delete_officer(
    ws: WebSocket,
    admin: User,
    data: dict,
    active_connections: list[Connection],
) -> None:
    """Permanently remove an officer's FieldOfficer and User records.

    Args:
        ws: The admin's socket.
        admin: Must pass can_manage_officers and cover the officer's province.
        data: Expects {"user_id": <uuid str>}.
        active_connections: Broadcast target so every admin's roster drops
            the deleted officer immediately.

    This is a hard delete (not a soft-disable); the FieldOfficer row is
    removed explicitly before the User row so any FK from FieldOfficer to
    User doesn't block the cascade.
    """
    try:
        user_id = uuid.UUID(data["user_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_user_id"})
        return
    async with async_session_maker() as session:
        if not await can_manage_officers(admin, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        ur_row = (
            await session.execute(
                select(UserRegion.name, Region.path)
                .join(Region, Region.id == UserRegion.region_id)
                .where(
                    UserRegion.user_id == user_id,
                    UserRegion.role == UserRole.FIELD_OFFICER,
                )
            )
        ).one_or_none()
        if ur_row is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        officer_name, province_path = ur_row

        if not await admin_covers_path(admin, province_path, session):
            await ws.send_json({"type": "error", "code": "out_of_scope"})
            return
        target = await session.get(User, user_id)
        if target is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        # Audit written before delete so entity details (name/division/path)
        # are still available to record.
        audit(
            session,
            actor=admin,
            action="officer.delete",
            entity_type="officer",
            entity_id=str(user_id),
            detail={
                "username": target.email,
                "name": officer_name,
                "division": target.division,
                "province_path": str(province_path),
            },
        )
        await session.execute(
            delete(FieldOfficer).where(FieldOfficer.user_id == user_id)
        )
        await session.delete(target)
        await session.commit()
    logger.info("officer deleted user=%s by admin=%s", user_id, admin.id)
    await ws.send_json({"type": "officer_deleted", "user_id": str(user_id)})
    await broadcast_admin_refresh(active_connections, include_pending=True)
