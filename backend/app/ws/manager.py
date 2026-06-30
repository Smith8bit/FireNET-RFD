import asyncio
import json
import time
from dataclasses import dataclass
from typing import Optional, Tuple

from fastapi import WebSocket

from ..database.models import User
from ..db_control.fires import get_fires
from ..db_control.permission import filter_fires

_SNAPSHOT_TTL_S = 1.0


@dataclass
class Connection:
    ws: WebSocket
    user: User
    is_super: bool = False
    paths: Tuple[str, ...] = ()
    can_view_officers: bool = False
    wants_map: bool = False
    viewport: Optional[tuple] = None

    @property
    def scope_key(self) -> Tuple[str, ...]:
        if self.is_super:
            return ("\x00super",)
        return tuple(sorted(self.paths))


def group_by_scope(conns) -> dict[Tuple[str, ...], list[Connection]]:
    groups: dict[Tuple[str, ...], list[Connection]] = {}
    for c in conns:
        groups.setdefault(c.scope_key, []).append(c)
    return groups


async def fanout(members, payload: str) -> None:
    async def _send(conn: Connection) -> None:
        await conn.ws.send_text(payload)

    await asyncio.gather(*(_send(m) for m in members), return_exceptions=True)


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[Connection] = []
        self._registry: dict[str, dict] = {}
        self._registry_at: float = 0.0
        self._version: dict[Tuple[str, ...], int] = {}
        self._snap_payload: dict[Tuple[str, ...], str] = {}
        self._snap_at: dict[Tuple[str, ...], float] = {}

    async def _scope_fires(self, conn: Connection) -> list[dict]:
        if self._registry and (time.monotonic() - self._registry_at) <= _SNAPSHOT_TTL_S:
            return filter_fires(
                list(conn.paths), list(self._registry.values()), conn.is_super
            )
        return await get_fires(user=conn.user)

    def _snapshot_json(self, conn: Connection, fires: list[dict]) -> str:
        return json.dumps(
            {
                "type": "fires_snapshot",
                "v": self._version.get(conn.scope_key, 0),
                "fires": fires,
            }
        )

    async def _snapshot_payload_for(self, conn: Connection) -> str:
        key = conn.scope_key
        ts = self._snap_at.get(key)
        if ts is not None and (time.monotonic() - ts) <= _SNAPSHOT_TTL_S:
            return self._snap_payload[key]
        payload = self._snapshot_json(conn, await self._scope_fires(conn))
        self._snap_payload[key] = payload
        self._snap_at[key] = time.monotonic()
        return payload

    async def connect(
        self,
        ws: WebSocket,
        user: User,
        paths: Tuple[str, ...] = (),
        can_view_officers: bool = False,
    ) -> Connection:
        await ws.accept()
        conn = Connection(
            ws=ws,
            user=user,
            is_super=bool(getattr(user, "is_superuser", False)),
            paths=tuple(paths),
            can_view_officers=can_view_officers,
        )
        self.active.append(conn)
        await ws.send_text(await self._snapshot_payload_for(conn))
        return conn

    async def send_snapshot(self, conn: Connection) -> None:
        await conn.ws.send_text(
            self._snapshot_json(conn, await self._scope_fires(conn))
        )

    def disconnect(self, ws: WebSocket) -> None:
        self.active = [c for c in self.active if c.ws is not ws]

    @staticmethod
    def diff_fires(
        old: dict[str, dict], new_list: list[dict]
    ) -> Tuple[list[dict], list[dict]]:
        new_by_id = {f["id"]: f for f in new_list}
        upserts = [f for fid, f in new_by_id.items() if old.get(fid) != f]
        removed = [old_f for fid, old_f in old.items() if fid not in new_by_id]
        return upserts, removed

    @staticmethod
    def route_delta(
        scope_paths, is_super: bool, upserts: list[dict], removed: list[dict]
    ) -> Tuple[list[dict], list[str]]:
        vis_up = filter_fires(scope_paths, upserts, is_super)
        vis_rm = [f["id"] for f in filter_fires(scope_paths, removed, is_super)]
        return vis_up, vis_rm

    def warm_registry_from(self, new_list: list[dict]) -> None:
        self._registry = {f["id"]: f for f in new_list}
        self._registry_at = time.monotonic()

    async def warm_registry(self) -> None:
        try:
            self.warm_registry_from(await get_fires(user=None))
        except Exception as exc:
            print(f"[ws] registry warm failed: {exc}")

    async def refresh_and_broadcast_deltas(self) -> None:
        try:
            new_list = await get_fires(user=None)
        except Exception as exc:
            print(f"[ws] delta refresh failed: {exc}")
            return
        upserts, removed = self.diff_fires(self._registry, new_list)
        self.warm_registry_from(new_list)
        if not upserts and not removed:
            return
        self._snap_payload.clear()
        self._snap_at.clear()
        for scope, members in group_by_scope(self.active).items():
            head = members[0]
            vis_up, vis_rm = self.route_delta(
                list(head.paths), head.is_super, upserts, removed
            )
            if not vis_up and not vis_rm:
                continue
            ver = self._version.get(scope, 0) + 1
            self._version[scope] = ver
            payload = json.dumps(
                {"type": "fires_delta", "v": ver, "upserts": vis_up, "removes": vis_rm}
            )
            await fanout(members, payload)


manager = ConnectionManager()
