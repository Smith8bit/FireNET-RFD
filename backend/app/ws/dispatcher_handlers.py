import logging
import uuid

from fastapi import WebSocket
from fastapi_users.exceptions import InvalidPasswordException, UserAlreadyExists
from fastapi_users.password import PasswordHelper
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import IntegrityError

from ..database import async_session_maker
from ..database.models import Region, User, UserRegion
from ..database.schemas import UserCreate
from ..db_control.audit import audit
from ..db_control.users import UserManager

logger = logging.getLogger("tfms.dispatchers")
_password_helper = PasswordHelper()
_MIN_PASSWORD_LEN = 8

# Dispatcher accounts are web-console users scoped to one region (regional or
# province level). Managing them is superuser-only — a regional dispatcher must
# not be able to create peers or escalate. Superusers carry role 'admin' on the
# national region, so filtering on role = 'dispatcher' already excludes them.
_DISPATCHERS_SQL = """
    SELECT u.id AS user_id, u.email AS email, ur.name AS name,
           r.id AS region_id, r.code AS region_code, r.name_th AS region_name_th,
           r.level AS region_level, r.path::text AS region_path
    FROM "user" u
    JOIN user_regions ur ON ur.user_id = u.id AND ur.role = 'dispatcher'
    JOIN regions r ON r.id = ur.region_id
    WHERE u.is_superuser = false
    ORDER BY r.path, u.email
"""


def _valid_email(email: str) -> bool:
    return "@" in email and "." in email


async def _fetch_dispatchers(session) -> list[dict]:
    rows = await session.execute(text(_DISPATCHERS_SQL))
    return [
        {
            "user_id": str(m["user_id"]),
            "email": m["email"],
            "name": m["name"],
            "region_id": str(m["region_id"]),
            "region_code": m["region_code"],
            "region_name_th": m["region_name_th"],
            "region_level": m["region_level"],
            "region_path": m["region_path"],
        }
        for m in rows.mappings().all()
    ]


async def handle_list_dispatchers(ws: WebSocket, user: User) -> None:
    if not user.is_superuser:
        await ws.send_json({"type": "error", "code": "forbidden"})
        return
    async with async_session_maker() as session:
        dispatchers = await _fetch_dispatchers(session)
    await ws.send_json({"type": "dispatchers", "dispatchers": dispatchers})


async def _send_dispatcher_list(ws: WebSocket) -> None:
    async with async_session_maker() as session:
        dispatchers = await _fetch_dispatchers(session)
    await ws.send_json({"type": "dispatchers", "dispatchers": dispatchers})


async def handle_create_dispatcher(ws: WebSocket, actor: User, data: dict) -> None:
    """Superuser provisions a new dispatcher account assigned to one region."""
    if not actor.is_superuser:
        await ws.send_json({"type": "error", "code": "forbidden"})
        return

    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    name = (data.get("name") or "").strip() or None
    region_id_raw = data.get("region_id")

    if not _valid_email(email):
        await ws.send_json({"type": "error", "code": "invalid_email"})
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
                UserCreate(email=email, password=password, is_superuser=False, is_verified=True),
                safe=False,
            )
        except UserAlreadyExists:
            await ws.send_json({"type": "error", "code": "email_taken"})
            return
        except InvalidPasswordException:
            await ws.send_json({"type": "error", "code": "weak_password"})
            return

        session.add(
            UserRegion(user_id=new_user.id, region_id=region.id, role="dispatcher", name=name)
        )
        audit(session, actor=actor, action="dispatcher.create", entity_type="user",
              entity_id=str(new_user.id),
              detail={"email": email, "name": name, "region_path": str(region.path)})
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            await ws.send_json({"type": "error", "code": "email_taken"})
            return

    logger.info("dispatcher created user=%s by superuser=%s", new_user.id, actor.id)
    await ws.send_json({"type": "dispatcher_created", "user_id": str(new_user.id)})
    await _send_dispatcher_list(ws)


async def handle_update_dispatcher(ws: WebSocket, actor: User, data: dict) -> None:
    """Superuser edit of a dispatcher's name, region, login email and/or password."""
    if not actor.is_superuser:
        await ws.send_json({"type": "error", "code": "forbidden"})
        return
    try:
        user_id = uuid.UUID(data["user_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_user_id"})
        return

    new_name = (data.get("name") or "").strip() or None if "name" in data else None
    new_email = ((data.get("email") or "").strip().lower() or None) if "email" in data else None
    new_password = data.get("password") or None
    region_id_raw = data.get("region_id")
    new_region_id = None
    if region_id_raw:
        try:
            new_region_id = uuid.UUID(region_id_raw)
        except (TypeError, ValueError):
            await ws.send_json({"type": "error", "code": "invalid_region"})
            return

    if new_name is None and new_email is None and new_password is None and new_region_id is None:
        await ws.send_json({"type": "error", "code": "nothing_to_update"})
        return
    if new_email is not None and not _valid_email(new_email):
        await ws.send_json({"type": "error", "code": "invalid_email"})
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
            await ws.send_json({"type": "error", "code": "not_found"})
            return

        changes: dict = {}
        if new_name is not None and new_name != ur_row.name:
            changes["name"] = new_name

        new_region = None
        if new_region_id is not None and new_region_id != ur_row.region_id:
            new_region = await session.get(Region, new_region_id)
            if new_region is None:
                await ws.send_json({"type": "error", "code": "invalid_region"})
                return
            changes["region_path"] = str(new_region.path)

        if new_email is not None and new_email != target.email:
            changes["email"] = new_email
            changes["previous_email"] = target.email
            target.email = new_email
        if new_password is not None:
            # record only that a reset happened — never the secret itself
            target.hashed_password = _password_helper.hash(new_password)
            changes["password_changed"] = True

        if not changes:
            await ws.send_json({"type": "dispatcher_updated", "user_id": str(user_id)})
            return

        # region_id is part of the composite PK — move the row via UPDATE, not ORM identity
        if new_region is not None:
            old_region_id = ur_row.region_id
            new_name_value = new_name if "name" in changes else ur_row.name
            session.expunge(ur_row)
            await session.execute(
                update(UserRegion)
                .where(UserRegion.user_id == user_id, UserRegion.region_id == old_region_id)
                .values(region_id=new_region.id, name=new_name_value)
            )
        elif "name" in changes:
            ur_row.name = new_name

        audit(session, actor=actor, action="dispatcher.update", entity_type="user",
              entity_id=str(user_id), detail=changes)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            await ws.send_json({"type": "error", "code": "email_taken"})
            return

    logger.info("dispatcher updated user=%s by superuser=%s changes=%s",
                user_id, actor.id, sorted(changes))
    await ws.send_json({"type": "dispatcher_updated", "user_id": str(user_id)})
    await _send_dispatcher_list(ws)


async def handle_delete_dispatcher(ws: WebSocket, actor: User, data: dict) -> None:
    """Superuser removes a dispatcher account entirely.

    Deleting the user cascades user_regions and device_tokens; audit_log.actor_id
    is SET NULL so history stays intact (attributed by the denormalized actor_email)."""
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

        audit(session, actor=actor, action="dispatcher.delete", entity_type="user",
              entity_id=str(user_id),
              detail={"email": target.email, "name": user_region.name,
                      "region_path": str(region_path)})
        await session.delete(target)
        await session.commit()

    logger.info("dispatcher deleted user=%s by superuser=%s", user_id, actor.id)
    await ws.send_json({"type": "dispatcher_deleted", "user_id": str(user_id)})
    await _send_dispatcher_list(ws)
