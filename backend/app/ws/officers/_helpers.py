"""Shared helpers for officer-related WebSocket broadcasts and scope checks.

Kept separate from manager.py because officer data (unlike fires) is scoped
by explicit region-coverage queries against the DB rather than the in-memory
ltree path matching used for fires, and is only relevant to connections with
`can_view_officers=True` (i.e. dispatcher/admin clients, not field officers).
"""

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
    """Check whether `admin` has region authority over ltree `path`.

    Superusers always cover every path. Otherwise this is a DB-level
    ancestor check (`path <@ r.path`, i.e. is the target path contained
    within one of the admin's assigned region paths) rather than an
    in-memory comparison, since region hierarchies are stored as ltree.
    """
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
    """Trim a full officer row down to the fields needed for the map view.

    Sent as a smaller, higher-frequency payload (`officers_map`) separate
    from the full `officers_in_region` list, to avoid pushing rarely-changing
    fields (contact info, etc.) on every location update.
    """
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
    """Push a fresh `officers_in_region` list to every officer-viewing connection.

    Connections are grouped by scope so `fetch_officers` (a scoped DB query)
    runs once per distinct scope rather than once per socket. A failure for
    one scope is logged and skipped so it doesn't block updates to others.
    """
    admins = [c for c in active_connections if c.can_view_officers]
    async with async_session_maker() as session:
        for scope, members in group_by_scope(admins).items():
            try:
                # members share identical visibility, so any one of them
                # (members[0]) is representative for the scoped query.
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
    """Push officers_in_region + officers_map, and optionally pending_officers.

    Args:
        active_connections: All currently connected sockets; filtered down to
            those with can_view_officers=True.
        include_pending: When True, also (re)send the pending-verification
            list — set by callers when a change could affect verification
            state (e.g. a user record changed), to avoid the cost of always
            querying pending officers on every refresh.
    """
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
        # Separate session/loop: pending list uses a different scoped query
        # and shouldn't block or be blocked by the officers/map broadcast above.
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
