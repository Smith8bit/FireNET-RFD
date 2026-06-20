import asyncio
import json
import time
from dataclasses import dataclass
from typing import Optional, Tuple

from fastapi import WebSocket

from ..database.models import User
from ..db_control.fires import get_fires
from ..db_control.permission import filter_fires

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
    # resolved once at connect: does this user hold officers.view? Gates officer
    # broadcasts so a console user without it gets no officer data (list or map).
    can_view_officers: bool = False
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
        # --- per-fire delta path (the live path) ---
        # the authoritative national fire set (id -> fire dict, each carrying a
        # `path`), kept fresh by refresh_and_broadcast_deltas; diffed to compute
        # deltas and used to serve connect snapshots from a single fetch.
        self._registry: dict[str, dict] = {}
        self._registry_at: float = 0.0
        # per-scope monotonic delta version. A client detects a gap when an
        # incoming delta isn't exactly its last version + 1, and asks to resync.
        self._version: dict[Tuple[str, ...], int] = {}
        # per-scope SERIALIZED snapshot cache (short TTL) so a reconnect storm
        # shares one query AND one serialization per scope, not per socket.
        self._snap_payload: dict[Tuple[str, ...], str] = {}
        self._snap_at: dict[Tuple[str, ...], float] = {}
        # --- legacy full-list broadcast (retained for the peak-load sims;
        #     production uses the delta path above) ---
        self._fire_payload: dict[Tuple[str, ...], str] = {}
        self._fire_at: dict[Tuple[str, ...], float] = {}

    # ---- connect snapshot + resync ----
    async def _scope_fires(self, conn: Connection) -> list[dict]:
        """The scope-visible fire list: from the warm national registry (one fetch
        feeds every scope) or a per-scope get_fires() fallback (cold start and the
        DB-free sims)."""
        if self._registry and (time.monotonic() - self._registry_at) <= _SNAPSHOT_TTL_S:
            return filter_fires(list(conn.paths), list(self._registry.values()), conn.is_super)
        return await get_fires(user=conn.user)

    def _snapshot_json(self, conn: Connection, fires: list[dict]) -> str:
        return json.dumps({"type": "fires_snapshot",
                           "v": self._version.get(conn.scope_key, 0), "fires": fires})

    async def _snapshot_payload_for(self, conn: Connection) -> str:
        """Serialized connect snapshot, cached per scope on a short TTL so a
        reconnect storm shares one query AND one serialization per scope."""
        key = conn.scope_key
        ts = self._snap_at.get(key)
        if ts is not None and (time.monotonic() - ts) <= _SNAPSHOT_TTL_S:
            return self._snap_payload[key]
        payload = self._snapshot_json(conn, await self._scope_fires(conn))
        self._snap_payload[key] = payload
        self._snap_at[key] = time.monotonic()
        return payload

    async def connect(self, ws: WebSocket, user: User, paths: Tuple[str, ...] = (),
                      can_view_officers: bool = False) -> Connection:
        await ws.accept()
        conn = Connection(
            ws=ws, user=user, is_super=bool(getattr(user, "is_superuser", False)),
            paths=tuple(paths), can_view_officers=can_view_officers,
        )
        # subscribe before sending the snapshot so a concurrent delta is never lost
        # (an early delta only triggers a harmless client resync)
        self.active.append(conn)
        await ws.send_text(await self._snapshot_payload_for(conn))
        return conn

    async def send_snapshot(self, conn: Connection) -> None:
        """Re-baseline one client at the CURRENT version — the resync recovery.
        Built fresh (not from the connect cache) so a client that hit a version gap
        isn't handed back a stale-versioned snapshot."""
        await conn.ws.send_text(self._snapshot_json(conn, await self._scope_fires(conn)))

    def disconnect(self, ws: WebSocket) -> None:
        self.active = [c for c in self.active if c.ws is not ws]

    # ---- per-fire delta broadcast (the live path) ----
    @staticmethod
    def diff_fires(old: dict[str, dict], new_list: list[dict]) -> Tuple[list[dict], list[dict]]:
        """Pure diff of the fire registry: returns (upserts, removed_dicts).
        `upserts` are new or changed fires; `removed_dicts` are the prior dicts of
        fires that disappeared (kept so removes can be routed by their `path`)."""
        new_by_id = {f["id"]: f for f in new_list}
        upserts = [f for fid, f in new_by_id.items() if old.get(fid) != f]
        removed = [old_f for fid, old_f in old.items() if fid not in new_by_id]
        return upserts, removed

    @staticmethod
    def route_delta(scope_paths, is_super: bool, upserts: list[dict],
                    removed: list[dict]) -> Tuple[list[dict], list[str]]:
        """The upserts and removed-ids visible to one scope, using the same
        ltree-prefix visibility filter as the snapshot/REST paths."""
        vis_up = filter_fires(scope_paths, upserts, is_super)
        vis_rm = [f["id"] for f in filter_fires(scope_paths, removed, is_super)]
        return vis_up, vis_rm

    def warm_registry_from(self, new_list: list[dict]) -> None:
        self._registry = {f["id"]: f for f in new_list}
        self._registry_at = time.monotonic()

    async def warm_registry(self) -> None:
        """Populate the registry at startup so the first change after boot sends a
        minimal delta instead of the whole list."""
        try:
            self.warm_registry_from(await get_fires(user=None))
        except Exception as exc:
            print(f"[ws] registry warm failed: {exc}")

    async def refresh_and_broadcast_deltas(self) -> None:
        """Re-read the national fire set once, diff it against the registry, and
        fan out per-fire deltas to each scope that can see a change. Replaces the
        full-list broadcast on the live (pg_listener) path: one DB fetch + an
        in-memory diff per change, and only the changed fires on the wire."""
        try:
            new_list = await get_fires(user=None)
        except Exception as exc:
            print(f"[ws] delta refresh failed: {exc}")
            return
        upserts, removed = self.diff_fires(self._registry, new_list)
        self.warm_registry_from(new_list)
        if not upserts and not removed:
            return
        # any real change makes every cached connect-snapshot stale (it predates
        # this change and bakes in an older version): drop them so the next connect
        # rebuilds fresh from the warm registry at the current version
        self._snap_payload.clear()
        self._snap_at.clear()
        for scope, members in group_by_scope(self.active).items():
            head = members[0]
            vis_up, vis_rm = self.route_delta(list(head.paths), head.is_super, upserts, removed)
            if not vis_up and not vis_rm:
                continue
            ver = self._version.get(scope, 0) + 1
            self._version[scope] = ver
            payload = json.dumps({"type": "fires_delta", "v": ver,
                                  "upserts": vis_up, "removes": vis_rm})
            await fanout(members, payload)

    # ---- legacy full-list broadcast (peak-load sims / benchmarks) ----
    async def _build_fire_payload(self, user: User) -> str:
        fires = await get_fires(user=user)
        return json.dumps({"fires": fires})

    def _store_fire_payload(self, key: Tuple[str, ...], payload: str) -> None:
        self._fire_payload[key] = payload
        self._fire_at[key] = time.monotonic()

    async def broadcast_fires(self) -> None:
        """Full per-scope fire list with per-scope dedupe — the pre-delta model,
        retained for the peak-load simulations. The live path is
        refresh_and_broadcast_deltas.

        One DB fetch per distinct scope, fanned out to all of that scope's
        sockets; a scope whose payload is byte-identical to the last one it
        received is skipped."""
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
