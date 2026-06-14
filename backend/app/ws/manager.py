import asyncio
import json
from dataclasses import dataclass, field
from typing import Optional, Tuple

from fastapi import WebSocket

from ..database.models import User
from ..db_control.fires import get_fires


@dataclass
class Connection:
    """One admin websocket plus the visibility scope resolved at connect time.

    `paths` are the user's assigned ltree region paths (empty for a superuser);
    `scope_key` collapses every connection that sees the SAME set of fires into a
    single bucket, so a broadcast can query the DB once per scope instead of once
    per socket."""
    ws: WebSocket
    user: User
    is_super: bool = False
    paths: Tuple[str, ...] = ()
    wants_map: bool = False
    viewport: Optional[tuple] = None

    @property
    def scope_key(self) -> Tuple[str, ...]:
        # the sentinel keeps the national/superuser scope distinct from any set of
        # province paths (a province key can never contain a NUL label)
        if self.is_super:
            return ("\x00super",)
        return tuple(sorted(self.paths))


def group_by_scope(conns) -> dict[Tuple[str, ...], list[Connection]]:
    """Bucket connections by their visibility scope. Turns a broadcast from
    O(connections) DB queries into O(distinct scopes)."""
    groups: dict[Tuple[str, ...], list[Connection]] = {}
    for c in conns:
        groups.setdefault(c.scope_key, []).append(c)
    return groups


async def fanout(members, payload: str) -> None:
    """Send one already-serialized payload to every member of a scope. A single
    dead socket must not stop delivery to the rest."""
    async def _send(conn: Connection) -> None:
        await conn.ws.send_text(payload)

    await asyncio.gather(*(_send(m) for m in members), return_exceptions=True)


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[Connection] = []

    async def connect(self, ws: WebSocket, user: User, paths: Tuple[str, ...] = ()) -> Connection:
        await ws.accept()
        conn = Connection(
            ws=ws, user=user, is_super=bool(getattr(user, "is_superuser", False)),
            paths=tuple(paths),
        )
        self.active.append(conn)
        # initial snapshot is inherently per-connection (one new socket); the
        # bucketing win is in the recurring broadcasts below
        fires = await get_fires(user=user)
        await ws.send_json({"fires": fires})
        return conn

    def disconnect(self, ws: WebSocket) -> None:
        self.active = [c for c in self.active if c.ws is not ws]

    async def broadcast_fires(self) -> None:
        """Push a fresh, per-scope-visible fire list to every client — one DB
        fetch per distinct scope, fanned out to all of that scope's sockets."""
        for scope, members in group_by_scope(self.active).items():
            try:
                fires = await get_fires(user=members[0].user)
                payload = json.dumps({"fires": fires})
            except Exception as exc:
                print(f"[ws] fire broadcast failed for scope {scope}: {exc}")
                continue
            await fanout(members, payload)


manager = ConnectionManager()
