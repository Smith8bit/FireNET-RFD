import uuid

from fastapi import WebSocket
from sqlalchemy import select, text, update

from ..config import get_settings
from ..database import async_session_maker
from ..database.models import FieldOfficer, Region, User, UserRegion
from ..db_control.audit import audit
from ..db_control.permission import is_admin_user, user_region_paths

settings = get_settings()

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


async def _is_admin(user: User, session) -> bool:
    return await is_admin_user(user, session)


async def _fetch_officers(session, user: User) -> list[dict]:
    ttl = settings.OFFICER_ONLINE_TTL_MINUTES
    if user.is_superuser:
        rows = await session.execute(
            text(_OFFICERS_SQL + " ORDER BY u.email").bindparams(ttl=ttl)
        )
    else:
        paths = await user_region_paths(user, session)
        if not paths:
            return []
        rows = await session.execute(
            text(_OFFICERS_SQL + " AND r.path <@ ANY(CAST(:paths AS ltree[])) ORDER BY u.email")
            .bindparams(paths=paths, ttl=ttl)
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
    async with async_session_maker() as session:
        for ws, user in list(active_connections):
            try:
                if not await _is_admin(user, session):
                    continue
                officers = await _fetch_officers(session, user)
                # ASCII only: a non-cp1252 char here raises on Windows consoles and kills the send
                print(f"[broadcast] officers_in_region -> {user.email}: {len(officers)} officers")
                await ws.send_json({"type": "officers_in_region", "officers": officers})
            except Exception as exc:
                print(f"[broadcast] failed to send to {user.email}: {exc}")


async def broadcast_admin_refresh(active_connections, include_pending: bool = False) -> None:
    """Push fresh officer lists (and optionally the pending list) to every admin."""
    admins: list[tuple[WebSocket, User]] = []
    async with async_session_maker() as session:
        for ws, user in list(active_connections):
            if await _is_admin(user, session):
                admins.append((ws, user))
        for ws, user in admins:
            try:
                officers = await _fetch_officers(session, user)
                await ws.send_json({"type": "officers_in_region", "officers": officers})
                await ws.send_json({"type": "officers_map", "officers": _map_subset(officers)})
            except Exception as exc:
                print(f"[broadcast] officer refresh failed for {user.email}: {exc}")
    if include_pending:
        for ws, user in admins:
            try:
                await handle_list_pending(ws, user)
            except Exception as exc:
                print(f"[broadcast] pending refresh failed for {user.email}: {exc}")


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
            print(f"[verify] created FieldOfficer for user {user_id}")
        else:
            print(f"[verify] FieldOfficer already exists for user {user_id}")

        audit(session, actor=admin, action="officer.verify", entity_type="officer",
              entity_id=str(user_id),
              detail={"email": target.email, "name": officer_name, "province_path": str(province_path)})
        await session.commit()

    print(f"[verify] officer {user_id} verified by {admin.email}")
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
    """Admin edit of an officer's name and/or province assignment."""
    try:
        user_id = uuid.UUID(data["user_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_user_id"})
        return
    new_name = (data.get("name") or "").strip() or None if "name" in data else None
    province_code = (data.get("province_code") or "").strip() or None
    if new_name is None and province_code is None:
        await ws.send_json({"type": "error", "code": "nothing_to_update"})
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

        if changes:
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
            await session.commit()

    # keys only: values may hold Thai text, which can crash cp1252 console prints
    print(f"[update] officer {user_id} updated by {admin.email}: {sorted(changes)}")
    await ws.send_json({"type": "officer_updated", "user_id": str(user_id)})
    if changes:
        await broadcast_admin_refresh(active_connections, include_pending=True)
