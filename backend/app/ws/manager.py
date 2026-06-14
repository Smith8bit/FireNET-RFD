import asyncio
import json
import time
from dataclasses import dataclass
from typing import Optional, Tuple

from fastapi import WebSocket

from ..database.models import User
from ..db_control.fires import get_fires

# A fire snapshot is reused for connects landing in the same scope within this
# window, so a post-deploy reconnect storm collapses from one query per socket to
# one per scope. Broadcasts refresh it, so staleness is bounded by this anyway.
_SNAPSHOT_TTL_S = 1.0


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
        # scope_key -> (last serialized fires payload, monotonic timestamp).
        # Serves both the connect snapshot cache and the broadcast dedupe.
        self._fire_payload: dict[Tuple[str, ...], str] = {}
        self._fire_at: dict[Tuple[str, ...], float] = {}

    async def _build_fire_payload(self, user: User) -> str:
        fires = await get_fires(user=user)
        return json.dumps({"fires": fires})

    def _store_fire_payload(self, key: Tuple[str, ...], payload: str) -> None:
        self._fire_payload[key] = payload
        self._fire_at[key] = time.monotonic()

    def _fresh_fire_payload(self, key: Tuple[str, ...]) -> Optional[str]:
        ts = self._fire_at.get(key)
        if ts is not None and (time.monotonic() - ts) <= _SNAPSHOT_TTL_S:
            return self._fire_payload.get(key)
        return None

    async def connect(self, ws: WebSocket, user: User, paths: Tuple[str, ...] = ()) -> Connection:
        await ws.accept()
        conn = Connection(
            ws=ws, user=user, is_super=bool(getattr(user, "is_superuser", False)),
            paths=tuple(paths),
        )
        self.active.append(conn)
        # a concurrent reconnect storm shares one fresh snapshot per scope instead
        # of issuing a heavy get_fires() per socket
        payload = self._fresh_fire_payload(conn.scope_key)
        if payload is None:
            payload = await self._build_fire_payload(user)
            self._store_fire_payload(conn.scope_key, payload)
        await ws.send_text(payload)
        return conn

    def disconnect(self, ws: WebSocket) -> None:
        self.active = [c for c in self.active if c.ws is not ws]

    async def broadcast_fires(self) -> None:
        """Push a fresh, per-scope-visible fire list to every client — one DB
        fetch per distinct scope, fanned out to all of that scope's sockets.

        A global change (the pg_listener fires for any firespot/booking change)
        re-queries every scope, but a scope whose payload is byte-identical to the
        last one it received is skipped: a booking in one province no longer
        re-sends the full fire list to every admin in the country."""
        for scope, members in group_by_scope(self.active).items():
            try:
                payload = await self._build_fire_payload(members[0].user)
            except Exception as exc:
                print(f"[ws] fire broadcast failed for scope {scope}: {exc}")
                continue
            unchanged = self._fire_payload.get(scope) == payload
            self._store_fire_payload(scope, payload)
            if unchanged:
                continue
            await fanout(members, payload)


manager = ConnectionManager()
