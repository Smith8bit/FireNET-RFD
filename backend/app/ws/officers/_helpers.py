import json
import logging

from fastapi import WebSocket
from sqlalchemy import text

from ...database import async_session_maker
from ...database.models import User
from ...db_control.officers import OfficerRow, fetch_officers, fetch_pending
from ...db_control.permission import user_region_paths
from ..manager import Connection, fanout, group_by_scope

logger = logging.getLogger("firenet.officers")


async def admin_covers_path(admin: User, path, session) -> bool:
    if admin.is_superuser:
        return True
    ok = await session.execute(
        text(
            "SELECT 1 FROM regions r JOIN user_regions ur ON ur.region_id = r.id "
            "WHERE ur.user_id = :aid AND CAST(:p AS ltree) <@ r.path LIMIT 1"
        ).bindparams(aid=admin.id, p=str(path))
    )
    return ok.first() is not None


def map_subset(officers: list[OfficerRow]) -> list[dict]:
    return [
        {
            "field_officer_id": o["field_officer_id"],
            "name": o["name"],
            "division": o["division"],
            "active": o["active"],
            "busy": o["fire_id"] is not None,
            "last_updated": o["last_updated"],
            "location": o["location"],
            "province_name_th": o["province_name_th"],
        }
        for o in officers
    ]


async def broadcast_officers_update(active_connections: list[Connection]) -> None:
    admins = [c for c in active_connections if c.can_view_officers]
    async with async_session_maker() as session:
        for scope, members in group_by_scope(admins).items():
            try:
                officers = await fetch_officers(session, members[0].user)
                payload = json.dumps(
                    {"type": "officers_in_region", "officers": officers}
                )
            except Exception as exc:
                logger.warning(
                    "officer update broadcast failed scope=%s: %s", scope, exc
                )
                continue
            await fanout(members, payload)


async def broadcast_admin_refresh(
    active_connections: list[Connection], include_pending: bool = False
) -> None:
    admins = [c for c in active_connections if c.can_view_officers]
    async with async_session_maker() as session:
        for scope, members in group_by_scope(admins).items():
            try:
                officers = await fetch_officers(session, members[0].user)
                in_region = json.dumps(
                    {"type": "officers_in_region", "officers": officers}
                )
                officers_map = json.dumps(
                    {"type": "officers_map", "officers": map_subset(officers)}
                )
            except Exception as exc:
                logger.warning(
                    "officer refresh broadcast failed scope=%s: %s", scope, exc
                )
                continue
            await fanout(members, in_region)
            await fanout(members, officers_map)
    if include_pending:
        async with async_session_maker() as session:
            for scope, members in group_by_scope(admins).items():
                try:
                    pending = await fetch_pending(session, members[0].user)
                    payload = json.dumps(
                        {"type": "pending_officers", "officers": pending}
                    )
                except Exception as exc:
                    logger.warning("pending refresh failed scope=%s: %s", scope, exc)
                    continue
                await fanout(members, payload)
