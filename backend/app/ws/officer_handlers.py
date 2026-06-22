import json
import logging
import uuid
from datetime import datetime, timezone

from fastapi import WebSocket
from fastapi_users.password import PasswordHelper
from sqlalchemy import delete, or_, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import aliased

from ..config import get_settings
from ..database import async_session_maker
from ..database.models import (
    FieldOfficer,
    Firespot,
    Region,
    RegionChangeRequest,
    User,
    UserRegion,
)
from ..db_control.audit import audit
from ..db_control.permission import (
    can_manage_officers,
    has_perm,
    has_perm_anywhere,
    is_admin_user,
    user_region_paths,
)
from ..db_control.push import send_push
from ..database.schemas import valid_username
from .manager import fanout, group_by_scope

settings = get_settings()
logger = logging.getLogger("firenet.officers")
_password_helper = PasswordHelper()
_MIN_PASSWORD_LEN = 8

_PENDING_SQL = """
    SELECT u.id AS user_id, u.email AS username, ur.name AS name, u.division AS division,
           r.name_th AS province_name_th, r.path::text AS province_path
    FROM "user" u
    JOIN user_regions ur ON ur.user_id = u.id AND ur.role = 'field_officer'
    JOIN regions r ON r.id = ur.region_id
    WHERE u.is_verified = false
"""

_OFFICERS_SQL = """
    SELECT fo.id AS field_officer_id, fo.user_id, fo.name, u.email AS username, u.division AS division,
           (fo.active AND fo.last_updated > now() - make_interval(mins => :ttl)) AS active,
           fo.fire_id::text AS fire_id,
           fo.last_updated::text AS last_updated,
           ST_Y(fo.last_location::geometry) AS latitude,
           ST_X(fo.last_location::geometry) AS longitude,
           ur.created_at AS created_at,
           r.name_th AS province_name_th, r.path::text AS province_path
    FROM field_officers fo
    JOIN "user" u ON u.id = fo.user_id
    JOIN user_regions ur ON ur.user_id = fo.user_id AND ur.role = 'field_officer'
    JOIN regions r ON r.id = ur.region_id
    WHERE u.is_verified = true
"""

# A national/large-region admin must never be handed the whole fleet: cap every
# officer fetch at OFFICER_MAP_MAX, keeping the freshest (most recently active)
# rows. Province admins are far under the cap, so they're unaffected.
_OFFICERS_ORDER_CAP = " ORDER BY fo.last_updated DESC NULLS LAST LIMIT :cap"


async def _is_admin(user: User, session) -> bool:
    return await is_admin_user(user, session)


async def _can_manage(user: User, session) -> bool:
    return await can_manage_officers(user, session)


async def _can_view_officers(user: User, session) -> bool:
    return await has_perm_anywhere(user, "officers.view", session)


async def _fetch_officers(session, user: User, *, limit: int | None = None) -> list[dict]:
    ttl = settings.OFFICER_ONLINE_TTL_MINUTES
    cap = limit if limit is not None else settings.OFFICER_MAP_MAX
    if user.is_superuser:
        rows = await session.execute(
            text(_OFFICERS_SQL + _OFFICERS_ORDER_CAP).bindparams(ttl=ttl, cap=cap)
        )
    else:
        paths = await user_region_paths(user, session)
        if not paths:
            return []
        rows = await session.execute(
            text(_OFFICERS_SQL + " AND r.path <@ ANY(CAST(:paths AS ltree[]))" + _OFFICERS_ORDER_CAP)
            .bindparams(paths=paths, ttl=ttl, cap=cap)
        )
    return [
        {
            "field_officer_id": str(m["field_officer_id"]),
            "user_id": str(m["user_id"]),
            "name": m["name"],
            "username": m["username"],
            "division": m["division"],
            "active": m["active"],
            "fire_id": m["fire_id"],
            "last_updated": m["last_updated"],
            "location": {"latitude": m["latitude"], "longitude": m["longitude"]} if m["latitude"] is not None else None,
            "province_name_th": m["province_name_th"],
            "province_path": m["province_path"],
            "created_at": m["created_at"].isoformat() if m["created_at"] else None,
        }
        for m in rows.mappings().all()
    ]


async def handle_list_pending(ws: WebSocket, user: User) -> None:
    async with async_session_maker() as session:
        if not await _can_view_officers(user, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        if user.is_superuser:
            rows = await session.execute(text(_PENDING_SQL + " ORDER BY u.email"))
        else:
            paths = await user_region_paths(user, session)
            if not paths:
                await ws.send_json({"type": "pending_officers", "officers": []})
                return
            rows = await session.execute(
                text(_PENDING_SQL + " AND r.path <@ ANY(CAST(:paths AS ltree[])) ORDER BY u.email")
                .bindparams(paths=paths)
            )
        officers = [
            {
                "user_id": str(m["user_id"]),
                "username": m["username"],
                "name": m["name"],
                "division": m["division"],
                "province_name_th": m["province_name_th"],
                "province_path": m["province_path"],
            }
            for m in rows.mappings().all()
        ]
    await ws.send_json({"type": "pending_officers", "officers": officers})


async def _fetch_region_requests(session, user: User) -> list[dict]:
    """Pending officer move requests, scoped to the dispatcher's destination area:
    a dispatcher approves officers asking to join a province they cover."""
    dest = aliased(Region)
    cur = aliased(Region)
    stmt = (
        select(
            RegionChangeRequest.id,
            RegionChangeRequest.user_id,
            RegionChangeRequest.created_at,
            UserRegion.name.label("officer_name"),
            User.email.label("username"),
            cur.name_th.label("current_province"),
            dest.name_th.label("requested_province"),
        )
        .join(dest, dest.id == RegionChangeRequest.requested_region_id)
        .join(User, User.id == RegionChangeRequest.user_id)
        .join(
            UserRegion,
            (UserRegion.user_id == RegionChangeRequest.user_id)
            & (UserRegion.role == "field_officer"),
        )
        .join(cur, cur.id == UserRegion.region_id)
        .where(RegionChangeRequest.status == "pending")
        .order_by(RegionChangeRequest.created_at)
    )
    if not user.is_superuser:
        paths = await user_region_paths(user, session)
        if not paths:
            return []
        stmt = stmt.where(or_(*[dest.path.op("<@")(p) for p in paths]))
    rows = (await session.execute(stmt)).all()
    return [
        {
            "request_id": str(r.id),
            "user_id": str(r.user_id),
            "officer_name": r.officer_name,
            "username": r.username,
            "current_province": r.current_province,
            "requested_province": r.requested_province,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


async def handle_list_region_requests(ws: WebSocket, user: User) -> None:
    async with async_session_maker() as session:
        if not await _is_admin(user, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        requests = await _fetch_region_requests(session, user)
    await ws.send_json({"type": "region_change_requests", "requests": requests})


async def handle_decide_region_request(
    ws: WebSocket, admin: User, data: dict, active_connections
) -> None:
    """Approve (move the officer's province) or reject a region-change request."""
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
        if not await _can_manage(admin, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return

        req = await session.get(RegionChangeRequest, request_id)
        if req is None or req.status != "pending":
            await ws.send_json({"type": "error", "code": "not_found"})
            return

        dest = await session.get(Region, req.requested_region_id)
        if dest is None:
            await ws.send_json({"type": "error", "code": "invalid_region"})
            return
        # dispatcher must cover the destination province (they accept the officer)
        if not await _admin_covers_path(admin, dest.path, session):
            await ws.send_json({"type": "error", "code": "out_of_scope"})
            return

        ur = (
            await session.execute(
                select(UserRegion).where(
                    UserRegion.user_id == req.user_id,
                    UserRegion.role == "field_officer",
                )
            )
        ).scalar_one_or_none()
        if ur is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        # origin province — captured before any move, recorded on both outcomes
        old_region_id = ur.region_id
        if action == "approve":
            # region_id is part of the composite PK — move via UPDATE, not ORM identity
            session.expunge(ur)
            await session.execute(
                update(UserRegion)
                .where(
                    UserRegion.user_id == req.user_id,
                    UserRegion.region_id == old_region_id,
                )
                .values(region_id=dest.id)
            )

        req.status = "approved" if action == "approve" else "rejected"
        req.decided_at = datetime.now(timezone.utc)
        req.decided_by = admin.id
        # officer name + origin province so the console trail reads
        # "name: old → new" on both outcomes without extra client lookups
        officer_name = (
            await session.execute(
                select(UserRegion.name).where(
                    UserRegion.user_id == req.user_id, UserRegion.role == "field_officer"
                )
            )
        ).scalar_one_or_none()
        prev_path = (
            await session.execute(select(Region.path).where(Region.id == old_region_id))
        ).scalar_one_or_none()
        detail = {"request_id": str(req.id), "province_path": str(dest.path),
                  "officer_name": officer_name,
                  "previous_province_path": str(prev_path) if prev_path is not None else None}
        audit(session, actor=admin, action=f"region_change.{req.status}", entity_type="user",
              entity_id=str(req.user_id), detail=detail)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            await ws.send_json({"type": "error", "code": "conflict"})
            return
        notify_user_id = req.user_id
        decided_status = req.status
        province_name = dest.name_th

    # tell the officer the outcome (best-effort, outside the decision transaction)
    approved = decided_status == "approved"
    async with async_session_maker() as session:
        await send_push(
            session, notify_user_id,
            title="อนุมัติคำขอย้ายพื้นที่" if approved else "ปฏิเสธคำขอย้ายพื้นที่",
            body=(f"คำขอย้ายไปยัง {province_name} ได้รับการอนุมัติแล้ว" if approved
                  else f"คำขอย้ายไปยัง {province_name} ถูกปฏิเสธ"),
            data={"type": "region_change", "status": decided_status},
        )
        await session.commit()

    logger.info("region request %s %s by admin=%s", request_id, req.status, admin.id)
    await ws.send_json({"type": "region_request_decided", "request_id": str(request_id), "status": req.status})
    await handle_list_region_requests(ws, admin)
    if action == "approve":
        # the officer's province changed — refresh officer/pending lists for admins
        await broadcast_admin_refresh(active_connections, include_pending=True)


async def handle_list_officers(ws: WebSocket, user: User) -> None:
    async with async_session_maker() as session:
        if not await _can_view_officers(user, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        officers = await _fetch_officers(session, user)
    logger.info("list_officers user=%s count=%d", user.id, len(officers))
    await ws.send_json({"type": "officers_in_region", "officers": officers})

def _map_subset(officers: list[dict]) -> list[dict]:
    return [
        {
            "field_officer_id": o["field_officer_id"],
            "name": o["name"],
            "active": o["active"],
            "busy": o["fire_id"] is not None,  # already holds a fire → not appointable
            "last_updated": o["last_updated"],
            "location": o["location"],
            "province_name_th": o["province_name_th"],
        }
        for o in officers
    ]


async def handle_list_officers_MAP(ws: WebSocket, user: User) -> None:
    async with async_session_maker() as session:
        if not await _can_view_officers(user, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        officers = await _fetch_officers(session, user)
    map_officers = _map_subset(officers)
    logger.info("list_officers_MAP user=%s count=%d", user.id, len(map_officers))
    await ws.send_json({"type": "officers_map", "officers": map_officers})


async def broadcast_officers_update(active_connections) -> None:
    """Bucketed: one officer fetch per distinct scope, fanned out to its sockets."""
    # only push officer data to connections that hold officers.view (resolved once
    # at connect); the rest get no officer list or map markers
    admins = [c for c in active_connections if c.can_view_officers]
    async with async_session_maker() as session:
        for scope, members in group_by_scope(admins).items():
            try:
                officers = await _fetch_officers(session, members[0].user)
                payload = json.dumps({"type": "officers_in_region", "officers": officers})
            except Exception as exc:
                logger.warning("officer update broadcast failed scope=%s: %s", scope, exc)
                continue
            await fanout(members, payload)


async def broadcast_admin_refresh(active_connections, include_pending: bool = False) -> None:
    """Push fresh officer lists (and optionally the pending list) to every admin.

    Bucketed: the officer query runs once per distinct scope (not once per admin),
    and each scope's two payloads are serialized once and fanned out to every
    socket in that scope — same frames each admin received before, O(scopes) DB."""
    # only connections holding officers.view receive officer lists / map markers
    admins = [c for c in active_connections if c.can_view_officers]
    async with async_session_maker() as session:
        groups = group_by_scope(admins)
        for scope, members in groups.items():
            try:
                officers = await _fetch_officers(session, members[0].user)
                in_region = json.dumps({"type": "officers_in_region", "officers": officers})
                officers_map = json.dumps({"type": "officers_map", "officers": _map_subset(officers)})
            except Exception as exc:
                logger.warning("officer refresh broadcast failed scope=%s: %s", scope, exc)
                continue
            await fanout(members, in_region)
            await fanout(members, officers_map)
    if include_pending:
        for c in admins:
            try:
                await handle_list_pending(c.ws, c.user)
            except Exception as exc:
                logger.warning("pending refresh failed user=%s: %s", c.user.id, exc)


async def handle_verify_officer(ws: WebSocket, admin: User, data: dict, active_connections) -> None:
    try:
        user_id = uuid.UUID(data["user_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_user_id"})
        return

    async with async_session_maker() as session:
        if not await _can_manage(admin, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return

        ur_row = (
            await session.execute(
                select(Region.path, UserRegion.name)
                .join(UserRegion, UserRegion.region_id == Region.id)
                .where(UserRegion.user_id == user_id, UserRegion.role == "field_officer")
            )
        ).one_or_none()
        if ur_row is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        province_path, officer_name = ur_row

        if not await _admin_covers_path(admin, province_path, session):
            await ws.send_json({"type": "error", "code": "out_of_scope"})
            return

        target = await session.get(User, user_id)
        if target is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        target.is_verified = True

        existing_fo = (
            await session.execute(select(FieldOfficer).where(FieldOfficer.user_id == user_id))
        ).scalar_one_or_none()
        if existing_fo is None:
            session.add(FieldOfficer(user_id=user_id, name=officer_name))
            logger.info("created FieldOfficer user=%s", user_id)
        else:
            logger.info("FieldOfficer already exists user=%s", user_id)

        audit(session, actor=admin, action="officer.verify", entity_type="officer",
              entity_id=str(user_id),
              detail={"username": target.email, "name": officer_name,
                      "division": target.division, "province_path": str(province_path)})
        await session.commit()

    logger.info("officer verified user=%s by admin=%s", user_id, admin.id)
    await ws.send_json({"type": "officer_verified", "user_id": str(user_id)})
    await broadcast_officers_update(active_connections)


async def _admin_covers_path(admin: User, path, session) -> bool:
    if admin.is_superuser:
        return True
    ok = await session.execute(
        text(
            "SELECT 1 FROM regions r JOIN user_regions ur ON ur.region_id = r.id "
            "WHERE ur.user_id = :aid AND CAST(:p AS ltree) <@ r.path LIMIT 1"
        ).bindparams(aid=admin.id, p=str(path))
    )
    return ok.first() is not None


async def handle_update_officer(ws: WebSocket, admin: User, data: dict, active_connections) -> None:
    """Admin edit of an officer's name, province assignment, login email and/or password."""
    try:
        user_id = uuid.UUID(data["user_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_user_id"})
        return
    new_name = (data.get("name") or "").strip() or None if "name" in data else None
    province_code = (data.get("province_code") or "").strip() or None
    new_username = ((data.get("username") or "").strip() or None) if "username" in data else None
    new_password = data.get("password") or None
    new_division = ((data.get("division") or "").strip() or None) if "division" in data else None
    if (new_name is None and province_code is None and new_username is None
            and new_password is None and "division" not in data):
        await ws.send_json({"type": "error", "code": "nothing_to_update"})
        return
    if new_username is not None and not valid_username(new_username):
        await ws.send_json({"type": "error", "code": "invalid_username"})
        return
    if new_password is not None and len(new_password) < _MIN_PASSWORD_LEN:
        await ws.send_json({"type": "error", "code": "weak_password"})
        return

    async with async_session_maker() as session:
        if not await _can_manage(admin, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return

        ur_row = (
            await session.execute(
                select(UserRegion, Region.path)
                .join(Region, Region.id == UserRegion.region_id)
                .where(UserRegion.user_id == user_id, UserRegion.role == "field_officer")
            )
        ).one_or_none()
        if ur_row is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        user_region, current_path = ur_row

        if not await _admin_covers_path(admin, current_path, session):
            await ws.send_json({"type": "error", "code": "out_of_scope"})
            return

        target = await session.get(User, user_id)
        if target is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return

        changes: dict = {}
        ur_values: dict = {}
        if new_name is not None and new_name != user_region.name:
            changes["name"] = new_name
            changes["previous_name"] = user_region.name
            ur_values["name"] = new_name

        if province_code is not None:
            province = (
                await session.execute(
                    select(Region).where(Region.code == province_code, Region.level == "province")
                )
            ).scalar_one_or_none()
            if province is None:
                await ws.send_json({"type": "error", "code": "invalid_province"})
                return
            if province.id != user_region.region_id:
                # the admin must cover the destination province too
                if not await _admin_covers_path(admin, province.path, session):
                    await ws.send_json({"type": "error", "code": "out_of_scope"})
                    return
                changes["province_path"] = str(province.path)
                changes["previous_province_path"] = str(current_path)
                ur_values["region_id"] = province.id

        # login credentials live on the user row, not the region assignment
        if new_username is not None and new_username != target.email:
            changes["username"] = new_username
            changes["previous_username"] = target.email
            target.email = new_username
        if "division" in data and new_division != target.division:
            changes["division"] = new_division
            changes["previous_division"] = target.division
            target.division = new_division
        if new_password is not None:
            # never record the secret itself — only that a reset happened, and whose
            target.hashed_password = _password_helper.hash(new_password)
            changes["password_changed"] = True
            changes["officer_name"] = new_name or user_region.name or target.email

        if not changes:
            # every field matched the current value — nothing to persist or broadcast
            await ws.send_json({"type": "officer_updated", "user_id": str(user_id)})
            return

        if ur_values:
            # region_id is part of the composite PK — write via UPDATE, not ORM identity
            old_region_id = user_region.region_id
            session.expunge(user_region)
            await session.execute(
                update(UserRegion)
                .where(UserRegion.user_id == user_id, UserRegion.region_id == old_region_id)
                .values(**ur_values)
            )
            if "name" in ur_values:
                await session.execute(
                    update(FieldOfficer).where(FieldOfficer.user_id == user_id).values(name=new_name)
                )
        audit(session, actor=admin, action="officer.update", entity_type="officer",
              entity_id=str(user_id), detail=changes)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            await ws.send_json({"type": "error", "code": "username_taken"})
            return

    # keys only: values may hold Thai text / the new username, which we keep out of logs
    logger.info("officer updated user=%s by admin=%s changes=%s", user_id, admin.id, sorted(changes))
    await ws.send_json({"type": "officer_updated", "user_id": str(user_id)})
    await broadcast_admin_refresh(active_connections, include_pending=True)


async def handle_delete_officer(ws: WebSocket, admin: User, data: dict, active_connections) -> None:
    """Admin removes a field officer account entirely (within their scope).

    Deletes the FieldOfficer row first — its user_id FK is ON DELETE SET NULL but the
    column is NOT NULL, so the user row can't be dropped while it still points at one.
    Deleting the user then cascades user_regions and device_tokens; audit_log.actor_id
    and fire_resolutions.officer_id are SET NULL so history stays intact (attributed by
    the denormalized actor_email). Any fire the officer was holding is released."""
    try:
        user_id = uuid.UUID(data["user_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_user_id"})
        return

    async with async_session_maker() as session:
        if not await _can_manage(admin, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return

        ur_row = (
            await session.execute(
                select(UserRegion.name, Region.path)
                .join(Region, Region.id == UserRegion.region_id)
                .where(UserRegion.user_id == user_id, UserRegion.role == "field_officer")
            )
        ).one_or_none()
        if ur_row is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return
        officer_name, province_path = ur_row

        if not await _admin_covers_path(admin, province_path, session):
            await ws.send_json({"type": "error", "code": "out_of_scope"})
            return

        target = await session.get(User, user_id)
        if target is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return

        # capture attribution before the rows are gone
        audit(session, actor=admin, action="officer.delete", entity_type="officer",
              entity_id=str(user_id),
              detail={"username": target.email, "name": officer_name,
                      "division": target.division, "province_path": str(province_path)})
        # FieldOfficer must go before the user (NOT NULL user_id with SET NULL FK)
        await session.execute(delete(FieldOfficer).where(FieldOfficer.user_id == user_id))
        await session.delete(target)
        await session.commit()

    logger.info("officer deleted user=%s by admin=%s", user_id, admin.id)
    await ws.send_json({"type": "officer_deleted", "user_id": str(user_id)})
    await broadcast_admin_refresh(active_connections, include_pending=True)


async def handle_appoint_officer(ws: WebSocket, admin: User, data: dict, active_connections) -> None:
    """Admin appoints a fire to a specific field officer (the inverse of an
    officer self-reserving). Same first-come-first-served invariants apply:
    a fire is held by at most one officer, an officer holds at most one
    unresolved fire. On success the officer is notified via FCM; the pg_listener
    booking trigger refreshes every web client's fire/officer lists."""
    try:
        fire_id = uuid.UUID(data["fire_id"])
        officer_id = uuid.UUID(data["officer_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_request"})
        return

    notify_user_id = None
    fire_name = None
    async with async_session_maker() as session:
        if not await _can_manage(admin, session):
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
        if not await _admin_covers_path(admin, fire_path, session):
            await ws.send_json({"type": "error", "code": "out_of_scope"})
            return

        officer = await session.get(FieldOfficer, officer_id)
        if officer is None:
            await ws.send_json({"type": "error", "code": "officer_not_found"})
            return

        # the officer must be within the admin's scope too
        officer_path = (
            await session.execute(
                select(Region.path)
                .join(UserRegion, UserRegion.region_id == Region.id)
                .where(UserRegion.user_id == officer.user_id, UserRegion.role == "field_officer")
            )
        ).scalar_one_or_none()
        if officer_path is None or not await _admin_covers_path(admin, officer_path, session):
            await ws.send_json({"type": "error", "code": "out_of_scope"})
            return

        # fire must be free (idempotent if it's already this officer's)
        if officer.fire_id == fire_id:
            await ws.send_json({"type": "officer_appointed", "fire_id": str(fire_id),
                                "officer_id": str(officer_id)})
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
        # officer must not already hold a different unresolved fire (coexist rule)
        if officer.fire_id is not None:
            held = await session.get(Firespot, officer.fire_id)
            if held is not None and not held.status:
                await ws.send_json({"type": "error", "code": "officer_busy"})
                return

        officer.fire_id = fire_id
        officer.appointed = True  # dispatcher-assigned (vs. self-reserved)
        audit(session, actor=admin, action="fire.appoint", entity_type="fire",
              entity_id=str(fire_id),
              detail={"officer_id": str(officer_id), "officer_user_id": str(officer.user_id),
                      "name": fire.name, "officer_name": officer.name})
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            await ws.send_json({"type": "error", "code": "fire_already_booked"})
            return

        notify_user_id = officer.user_id
        fire_name = fire.name

    # push is best-effort and outside the appoint transaction
    if notify_user_id is not None:
        async with async_session_maker() as session:
            await send_push(
                session, notify_user_id,
                title="ได้รับมอบหมายงานใหม่",
                body=f"คุณได้รับมอบหมายให้ดูแลไฟ: {fire_name}",
                data={"type": "fire_appointment", "fire_id": str(fire_id)},
            )
            await session.commit()

    logger.info("fire appointed fire=%s officer=%s by admin=%s", fire_id, officer_id, admin.id)
    await ws.send_json({"type": "officer_appointed", "fire_id": str(fire_id),
                        "officer_id": str(officer_id)})


async def handle_cancel_booking(ws: WebSocket, user: User, data: dict, active_connections) -> None:
    """Release a held (booked, not yet resolved) fire from its officer.

    Who may cancel depends on how it was booked:
      - self-reserved (officer picked it themselves): any console user.
      - dispatcher-appointed: only fire.appoint, scoped to the fire's region
        (the same authority that made the appointment).
    The pg_listener booking trigger refreshes every client's fire/officer lists;
    the officer is notified by push."""
    try:
        fire_id = uuid.UUID(data["fire_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_request"})
        return

    notify_user_id = None
    fire_name = None
    async with async_session_maker() as session:
        officer = (
            await session.execute(select(FieldOfficer).where(FieldOfficer.fire_id == fire_id))
        ).scalar_one_or_none()
        if officer is None:
            await ws.send_json({"type": "error", "code": "not_booked"})
            return

        fire = await session.get(Firespot, fire_id)
        fire_name = fire.name if fire is not None else None

        if officer.appointed:
            # dispatcher-appointed: needs fire.appoint within the fire's region
            fire_path = None if fire is None else (
                await session.execute(select(Region.path).where(Region.id == fire.region_id))
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
        audit(session, actor=user, action="fire.cancel_booking", entity_type="fire",
              entity_id=str(fire_id),
              detail={"officer_id": str(officer.id), "officer_user_id": str(officer.user_id),
                      "name": fire_name, "officer_name": officer.name})
        await session.commit()

    if notify_user_id is not None:
        async with async_session_maker() as session:
            await send_push(
                session, notify_user_id,
                title="ยกเลิกการมอบหมายงาน",
                body=f"การมอบหมายไฟ {fire_name} ถูกยกเลิกแล้ว" if fire_name else "การมอบหมายงานถูกยกเลิกแล้ว",
                data={"type": "fire_cancelled", "fire_id": str(fire_id)},
            )
            await session.commit()

    logger.info("fire booking cancelled fire=%s by user=%s", fire_id, user.id)
    await ws.send_json({"type": "booking_cancelled", "fire_id": str(fire_id)})
