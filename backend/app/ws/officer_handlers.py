import json
import uuid

from fastapi import WebSocket
from fastapi_users.password import PasswordHelper
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import IntegrityError

from ..config import get_settings
from ..database import async_session_maker
from ..database.models import FieldOfficer, Firespot, Region, User, UserRegion
from ..db_control.audit import audit
from ..db_control.permission import is_admin_user, user_region_paths
from ..db_control.push import send_push
from .manager import fanout, group_by_scope

settings = get_settings()
_password_helper = PasswordHelper()
_MIN_PASSWORD_LEN = 8

_PENDING_SQL = """
    SELECT u.id AS user_id, u.email AS email, ur.name AS name,
           r.name_th AS province_name_th, r.path::text AS province_path
    FROM "user" u
    JOIN user_regions ur ON ur.user_id = u.id AND ur.role = 'field_officer'
    JOIN regions r ON r.id = ur.region_id
    WHERE u.is_verified = false
"""

_OFFICERS_SQL = """
    SELECT fo.id AS field_officer_id, fo.user_id, fo.name, u.email,
           (fo.active AND fo.last_updated > now() - make_interval(mins => :ttl)) AS active,
           fo.fire_id::text AS fire_id,
           fo.last_updated::text AS last_updated,
           ST_Y(fo.last_location::geometry) AS latitude,
           ST_X(fo.last_location::geometry) AS longitude,
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
            "email": m["email"],
            "active": m["active"],
            "fire_id": m["fire_id"],
            "last_updated": m["last_updated"],
            "location": {"latitude": m["latitude"], "longitude": m["longitude"]} if m["latitude"] is not None else None,
            "province_name_th": m["province_name_th"],
            "province_path": m["province_path"],
        }
        for m in rows.mappings().all()
    ]


async def handle_list_pending(ws: WebSocket, user: User) -> None:
    async with async_session_maker() as session:
        if not await _is_admin(user, session):
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
                "email": m["email"],
                "name": m["name"],
                "province_name_th": m["province_name_th"],
                "province_path": m["province_path"],
            }
            for m in rows.mappings().all()
        ]
    await ws.send_json({"type": "pending_officers", "officers": officers})


async def handle_list_officers(ws: WebSocket, user: User) -> None:
    async with async_session_maker() as session:
        if not await _is_admin(user, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        officers = await _fetch_officers(session, user)
    print(f"[officers] list_officers requested by {user.email}: {len(officers)} officers found")
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
        if not await _is_admin(user, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        officers = await _fetch_officers(session, user)
    map_officers = _map_subset(officers)
    print(f"[officers] list_officers_MAP requested by {user.email}: {len(map_officers)} officers found")
    await ws.send_json({"type": "officers_map", "officers": map_officers})


async def broadcast_officers_update(active_connections) -> None:
    """Bucketed: one officer fetch per distinct scope, fanned out to its sockets."""
    async with async_session_maker() as session:
        admins = [c for c in list(active_connections) if await _is_admin(c.user, session)]
        for scope, members in group_by_scope(admins).items():
            try:
                officers = await _fetch_officers(session, members[0].user)
                payload = json.dumps({"type": "officers_in_region", "officers": officers})
            except Exception as exc:
                print(f"[broadcast] officer update failed for scope {scope}: {exc}")
                continue
            await fanout(members, payload)


async def broadcast_admin_refresh(active_connections, include_pending: bool = False) -> None:
    """Push fresh officer lists (and optionally the pending list) to every admin.

    Bucketed: the officer query runs once per distinct scope (not once per admin),
    and each scope's two payloads are serialized once and fanned out to every
    socket in that scope — same frames each admin received before, O(scopes) DB."""
    async with async_session_maker() as session:
        admins = [c for c in list(active_connections) if await _is_admin(c.user, session)]
        groups = group_by_scope(admins)
        for scope, members in groups.items():
            try:
                officers = await _fetch_officers(session, members[0].user)
                in_region = json.dumps({"type": "officers_in_region", "officers": officers})
                officers_map = json.dumps({"type": "officers_map", "officers": _map_subset(officers)})
            except Exception as exc:
                print(f"[broadcast] officer refresh failed for scope {scope}: {exc}")
                continue
            await fanout(members, in_region)
            await fanout(members, officers_map)
    if include_pending:
        for c in admins:
            try:
                await handle_list_pending(c.ws, c.user)
            except Exception as exc:
                print(f"[broadcast] pending refresh failed for {c.user.email}: {exc}")


async def handle_verify_officer(ws: WebSocket, admin: User, data: dict, active_connections) -> None:
    try:
        user_id = uuid.UUID(data["user_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_user_id"})
        return

    async with async_session_maker() as session:
        if not await _is_admin(admin, session):
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
            print(f"[verify] created FieldOfficer for {target.email}")
        else:
            print(f"[verify] FieldOfficer already exists for {target.email}")

        audit(session, actor=admin, action="officer.verify", entity_type="officer",
              entity_id=str(user_id),
              detail={"email": target.email, "name": officer_name, "province_path": str(province_path)})
        await session.commit()

    print(f"[verify] officer {target.email} verified by {admin.email}")
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
    new_email = ((data.get("email") or "").strip().lower() or None) if "email" in data else None
    new_password = data.get("password") or None
    if new_name is None and province_code is None and new_email is None and new_password is None:
        await ws.send_json({"type": "error", "code": "nothing_to_update"})
        return
    if new_email is not None and ("@" not in new_email or "." not in new_email):
        await ws.send_json({"type": "error", "code": "invalid_email"})
        return
    if new_password is not None and len(new_password) < _MIN_PASSWORD_LEN:
        await ws.send_json({"type": "error", "code": "weak_password"})
        return

    async with async_session_maker() as session:
        if not await _is_admin(admin, session):
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
        if new_email is not None and new_email != target.email:
            changes["email"] = new_email
            changes["previous_email"] = target.email
            target.email = new_email
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
            await ws.send_json({"type": "error", "code": "email_taken"})
            return

    # keys only: values may hold Thai text / the new email, which we keep out of logs
    print(f"[update] officer {user_id} updated by {admin.email}: {sorted(changes)}")
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
        if not await _is_admin(admin, session):
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
              detail={"email": target.email, "name": officer_name, "province_path": str(province_path)})
        # FieldOfficer must go before the user (NOT NULL user_id with SET NULL FK)
        await session.execute(delete(FieldOfficer).where(FieldOfficer.user_id == user_id))
        await session.delete(target)
        await session.commit()

    print(f"[delete] officer {user_id} removed by {admin.email}")
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
        if not await _is_admin(admin, session):
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
        audit(session, actor=admin, action="fire.appoint", entity_type="fire",
              entity_id=str(fire_id),
              detail={"officer_id": str(officer_id), "officer_user_id": str(officer.user_id),
                      "name": fire.name})
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

    print(f"[appoint] fire {fire_id} -> officer {officer_id} by {admin.email}")
    await ws.send_json({"type": "officer_appointed", "fire_id": str(fire_id),
                        "officer_id": str(officer_id)})
