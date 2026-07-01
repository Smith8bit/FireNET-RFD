"""WS handlers for superuser-only CRUD over dispatcher accounts.

Dispatchers are a UserRegion role (like field officers) but are managed
exclusively by superusers, unlike field officers which regional admins can
also manage — hence every handler here checks `actor.is_superuser` directly
rather than the region-scoped `can_manage_officers`/`admin_covers_path`
helpers used in officers/.
"""

import logging
import uuid

from fastapi import WebSocket
from fastapi_users.exceptions import InvalidPasswordException, UserAlreadyExists
from fastapi_users.password import PasswordHelper
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError

from ..database import async_session_maker
from ..database.models import Region, User, UserRegion
from ..database.schemas import UserCreate, valid_username
from ..db_control.audit import audit
from ..db_control.permission import (
    GRANTABLE,
    PRESETS,
    has_perm_anywhere,
    update_user_region,
    user_region_paths,
)
from ..db_control.users import UserManager

logger = logging.getLogger("firenet.dispatchers")
_password_helper = PasswordHelper()
_MIN_PASSWORD_LEN = 8

# Raw SQL (rather than the ORM) because this joins three tables purely for a
# read-shaped, denormalized listing view; WHERE u.is_superuser = false
# excludes superusers even though they may technically hold a "dispatcher"
# UserRegion row, since they're managed separately.
_DISPATCHERS_SQL = """
    SELECT u.id AS user_id, u.email AS username, ur.name AS name, u.division AS division,
           ur.permissions AS permissions, ur.created_at AS created_at,
           r.id AS region_id, r.code AS region_code, r.name_th AS region_name_th,
           r.level AS region_level, r.path::text AS region_path
    FROM "user" u
    JOIN user_regions ur ON ur.user_id = u.id AND ur.role = 'dispatcher'
    JOIN regions r ON r.id = ur.region_id
    WHERE u.is_superuser = false
"""
_DISPATCHERS_ORDER = " ORDER BY r.path, u.email"


def _clean_permissions(raw, *, default) -> list[str]:
    """Sanitize a client-supplied permissions list against the GRANTABLE allowlist.

    Falls back to `default` (a role preset) if `raw` isn't a list at all,
    and silently drops any value not in GRANTABLE rather than erroring, so a
    stale client can't grant permissions that no longer exist or were never
    meant to be dispatcher-assignable.
    """
    if not isinstance(raw, list):
        return sorted(default)
    return sorted({p for p in raw if p in GRANTABLE})


async def _fetch_dispatchers(session, viewer: User) -> list[dict]:
    """Return dispatcher rows visible to `viewer`.

    Superusers see every dispatcher; anyone else only sees dispatchers whose
    region falls under one of the viewer's own assigned ltree paths
    (`<@ ANY(...)`), and gets an empty list outright if they have no regions.
    """
    if viewer.is_superuser:
        rows = await session.execute(text(_DISPATCHERS_SQL + _DISPATCHERS_ORDER))
    else:
        paths = await user_region_paths(viewer, session)
        if not paths:
            return []
        rows = await session.execute(
            text(
                _DISPATCHERS_SQL
                + " AND r.path <@ ANY(CAST(:paths AS ltree[]))"
                + _DISPATCHERS_ORDER
            ).bindparams(paths=paths)
        )
    return [
        {
            "user_id": str(m["user_id"]),
            "username": m["username"],
            "name": m["name"],
            "division": m["division"],
            "permissions": sorted(
                m["permissions"]
                if m["permissions"] is not None
                # NULL permissions (e.g. legacy rows predating the column)
                # fall back to the default dispatcher preset rather than an
                # empty/forbidden set.
                else PRESETS["dispatcher"]
            ),
            "region_id": str(m["region_id"]),
            "region_code": m["region_code"],
            "region_name_th": m["region_name_th"],
            "region_level": m["region_level"],
            "region_path": m["region_path"],
            "created_at": m["created_at"].isoformat() if m["created_at"] else None,
        }
        for m in rows.mappings().all()
    ]


async def handle_list_dispatchers(ws: WebSocket, user: User) -> None:
    """Send the caller their scoped dispatcher listing.

    Args:
        ws: The requesting client's socket.
        user: Must hold "dispatchers.view" in at least one region.
    """
    async with async_session_maker() as session:
        if not await has_perm_anywhere(user, "dispatchers.view", session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        dispatchers = await _fetch_dispatchers(session, user)
    await ws.send_json({"type": "dispatchers", "dispatchers": dispatchers})


async def _send_dispatcher_list(ws: WebSocket, viewer: User) -> None:
    """Unconditional re-send used after mutations, skipping the permission
    check (the caller already proved authority by successfully mutating)."""
    async with async_session_maker() as session:
        dispatchers = await _fetch_dispatchers(session, viewer)
    await ws.send_json({"type": "dispatchers", "dispatchers": dispatchers})


async def handle_create_dispatcher(ws: WebSocket, actor: User, data: dict) -> None:
    """Create a new dispatcher account scoped to a region.

    Args:
        ws: The superuser's socket.
        actor: Must be a superuser; regional admins cannot create dispatchers.
        data: Expects username, password, region_id, and optionally name,
            division, permissions (validated/sanitized before use).

    Uses UserManager.create(..., safe=False) to allow setting
    is_superuser/is_verified directly from server-side logic, bypassing the
    "safe" registration flow meant for public self-signup.
    """
    if not actor.is_superuser:
        await ws.send_json({"type": "error", "code": "forbidden"})
        return
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    name = (data.get("name") or "").strip() or None
    division = (data.get("division") or "").strip() or None
    region_id_raw = data.get("region_id")
    permissions = _clean_permissions(
        data.get("permissions"), default=PRESETS["dispatcher"]
    )

    if not valid_username(username):
        await ws.send_json({"type": "error", "code": "invalid_username"})
        return
    if len(password) < _MIN_PASSWORD_LEN:
        await ws.send_json({"type": "error", "code": "weak_password"})
        return
    try:
        region_id = uuid.UUID(region_id_raw)
    except (TypeError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_region"})
        return
    async with async_session_maker() as session:
        region = await session.get(Region, region_id)
        if region is None:
            await ws.send_json({"type": "error", "code": "invalid_region"})
            return
        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)
        try:
            new_user = await manager.create(
                UserCreate(
                    email=username,
                    password=password,
                    is_superuser=False,
                    is_verified=True,
                    division=division,
                ),
                safe=False,
            )
        except UserAlreadyExists:
            await ws.send_json({"type": "error", "code": "username_taken"})
            return
        except InvalidPasswordException:
            # fastapi-users' own password policy, distinct from our
            # length-only check above; both are checked since fastapi-users
            # may enforce additional rules (e.g. not matching the email).
            await ws.send_json({"type": "error", "code": "weak_password"})
            return
        session.add(
            UserRegion(
                user_id=new_user.id,
                region_id=region.id,
                role="dispatcher",
                name=name,
                permissions=permissions,
            )
        )
        audit(
            session,
            actor=actor,
            action="dispatcher.create",
            entity_type="user",
            entity_id=str(new_user.id),
            detail={
                "username": username,
                "name": name,
                "division": division,
                "region_path": str(region.path),
                "permissions": permissions,
            },
        )
        try:
            await session.commit()
        except IntegrityError:
            # Race: another request created the same username between our
            # UserAlreadyExists check and this commit.
            await session.rollback()
            await ws.send_json({"type": "error", "code": "username_taken"})
            return
    logger.info("dispatcher created user=%s by superuser=%s", new_user.id, actor.id)
    await ws.send_json({"type": "dispatcher_created", "user_id": str(new_user.id)})
    await _send_dispatcher_list(ws, actor)


async def handle_update_dispatcher(ws: WebSocket, actor: User, data: dict) -> None:
    """Partially update a dispatcher's profile, region, permissions, or password.

    Args:
        ws: The superuser's socket.
        actor: Must be a superuser.
        data: Partial-update payload; presence of a key (not its truthiness)
            determines whether that field is touched — mirrors the pattern in
            officers/management.handle_update_officer, so an omitted
            "division" leaves it alone but an explicit "division": "" clears it.

    Region moves go through `update_user_region` (keeping the UserRegion
    row's foreign key consistent) rather than a bare column assignment.
    """
    if not actor.is_superuser:
        await ws.send_json({"type": "error", "code": "forbidden"})
        return
    try:
        user_id = uuid.UUID(data["user_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_user_id"})
        return
    new_name = (data.get("name") or "").strip() or None if "name" in data else None
    new_username = (
        ((data.get("username") or "").strip() or None) if "username" in data else None
    )
    new_division = (
        ((data.get("division") or "").strip() or None) if "division" in data else None
    )
    new_password = data.get("password") or None
    new_permissions = (
        _clean_permissions(data.get("permissions"), default=PRESETS["dispatcher"])
        if "permissions" in data
        else None
    )
    region_id_raw = data.get("region_id")
    new_region_id = None
    if region_id_raw:
        try:
            new_region_id = uuid.UUID(region_id_raw)
        except (TypeError, ValueError):
            await ws.send_json({"type": "error", "code": "invalid_region"})
            return
    if (
        new_name is None
        and new_username is None
        and new_password is None
        and new_region_id is None
        and "division" not in data
        and new_permissions is None
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
        ur_row = (
            await session.execute(
                select(UserRegion).where(
                    UserRegion.user_id == user_id, UserRegion.role == "dispatcher"
                )
            )
        ).scalar_one_or_none()
        if ur_row is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        target = await session.get(User, user_id)
        if target is None or target.is_superuser:
            # Defends against a caller passing a superuser's own id: even
            # though the ur_row lookup already filters by role="dispatcher",
            # this double-checks the account itself isn't a superuser.
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        # `changes` is the audit-trail detail; individual DB writes happen
        # inline as each field is validated against current state.
        changes: dict = {}
        if new_name is not None and new_name != ur_row.name:
            changes["name"] = new_name
            changes["previous_name"] = ur_row.name
        if new_permissions is not None and new_permissions != sorted(
            ur_row.permissions or []
        ):
            changes["permissions"] = new_permissions
        new_region = None
        if new_region_id is not None and new_region_id != ur_row.region_id:
            new_region = await session.get(Region, new_region_id)
            if new_region is None:
                await ws.send_json({"type": "error", "code": "invalid_region"})
                return
            changes["region_path"] = str(new_region.path)
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
        if not changes:
            await ws.send_json({"type": "dispatcher_updated", "user_id": str(user_id)})
            return
        if new_region is not None:
            # When relocating, carry over name/permissions changes (if any)
            # into the same update_user_region call rather than issuing a
            # separate write, since that helper handles the region-move
            # bookkeeping (e.g. old/new region FK consistency) in one place.
            new_name_value = new_name if "name" in changes else ur_row.name
            new_perms_value = (
                new_permissions if "permissions" in changes else ur_row.permissions
            )
            await update_user_region(
                session,
                user_id=user_id,
                old_region_id=ur_row.region_id,
                ur_obj=ur_row,
                region_id=new_region.id,
                name=new_name_value,
                permissions=new_perms_value,
            )
        else:
            if "name" in changes:
                ur_row.name = new_name
            if "permissions" in changes:
                ur_row.permissions = new_permissions
        audit(
            session,
            actor=actor,
            action="dispatcher.update",
            entity_type="user",
            entity_id=str(user_id),
            detail=changes,
        )
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            await ws.send_json({"type": "error", "code": "username_taken"})
            return
    logger.info(
        "dispatcher updated user=%s by superuser=%s changes=%s",
        user_id,
        actor.id,
        sorted(changes),
    )
    await ws.send_json({"type": "dispatcher_updated", "user_id": str(user_id)})
    await _send_dispatcher_list(ws, actor)


async def handle_delete_dispatcher(ws: WebSocket, actor: User, data: dict) -> None:
    """Permanently delete a dispatcher account.

    Args:
        ws: The superuser's socket.
        actor: Must be a superuser.
        data: Expects {"user_id": <uuid str>}.

    Unlike officers/management.handle_delete_officer, there's no separate
    role-specific row to clean up first (dispatchers don't have a
    FieldOfficer counterpart) — deleting the User row is sufficient.
    """
    if not actor.is_superuser:
        await ws.send_json({"type": "error", "code": "forbidden"})
        return
    try:
        user_id = uuid.UUID(data["user_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_user_id"})
        return
    async with async_session_maker() as session:
        ur_row = (
            await session.execute(
                select(UserRegion, Region.path)
                .join(Region, Region.id == UserRegion.region_id)
                .where(UserRegion.user_id == user_id, UserRegion.role == "dispatcher")
            )
        ).one_or_none()
        if ur_row is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        user_region, region_path = ur_row

        target = await session.get(User, user_id)
        if target is None or target.is_superuser:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        # Audit written before delete so entity details are still available.
        audit(
            session,
            actor=actor,
            action="dispatcher.delete",
            entity_type="user",
            entity_id=str(user_id),
            detail={
                "username": target.email,
                "name": user_region.name,
                "division": target.division,
                "region_path": str(region_path),
            },
        )
        await session.delete(target)
        await session.commit()
    logger.info("dispatcher deleted user=%s by superuser=%s", user_id, actor.id)
    await ws.send_json({"type": "dispatcher_deleted", "user_id": str(user_id)})
    await _send_dispatcher_list(ws, actor)
