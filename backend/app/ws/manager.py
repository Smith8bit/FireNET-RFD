"""WebSocket connection registry and fire-data broadcast engine.

Dispatchers/officers connect once and get pushed live updates instead of
polling. To keep broadcast cost low with many concurrent sockets, connections
are grouped by "scope" (the set of region paths + superuser flag that
determines fire visibility) so a DB fetch + permission filter is done once per
distinct scope rather than once per socket.
"""

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Optional, Tuple

from fastapi import WebSocket

from ..database.models import User
from ..db_control.fires import get_fires
from ..db_control.permission import filter_fires

# How long a cached registry/snapshot is considered fresh before we refetch
# from the DB. Short enough to stay "live", long enough to collapse bursts of
# near-simultaneous connects/refreshes into a single query.
_SNAPSHOT_TTL_S = 1.0


@dataclass
class Connection:
    """A single accepted WebSocket paired with the viewer's access scope."""

    ws: WebSocket
    user: User
    is_super: bool = False
    paths: Tuple[str, ...] = ()  # ltree region paths this user is scoped to
    can_view_officers: bool = False
    wants_map: bool = False
    viewport: Optional[tuple] = None

    @property
    def scope_key(self) -> Tuple[str, ...]:
        """Key used to bucket connections that see the same fire data.

        Superusers all share one bucket (they see everything, regardless of
        paths) so their snapshots/deltas are computed and cached once. Other
        users are keyed by their sorted region paths so two dispatchers with
        identical scope reuse the same cached payload.
        """
        if self.is_super:
            return ("\x00super",)  # sentinel key distinct from any real path tuple
        return tuple(sorted(self.paths))


def group_by_scope(conns) -> dict[Tuple[str, ...], list[Connection]]:
    """Partition connections by scope_key so broadcasts can be computed once per group."""
    groups: dict[Tuple[str, ...], list[Connection]] = {}
    for c in conns:
        groups.setdefault(c.scope_key, []).append(c)
    return groups


async def fanout(members, payload: str) -> None:
    """Send the same pre-serialized JSON payload to every connection in a scope group.

    Uses return_exceptions=True so one dead/broken socket (e.g. client
    disconnected without us noticing yet) doesn't abort delivery to the rest
    of the group; failed sends are silently dropped and cleaned up on the
    next disconnect() call.
    """

    async def _send(conn: Connection) -> None:
        await conn.ws.send_text(payload)

    await asyncio.gather(*(_send(m) for m in members), return_exceptions=True)


class ConnectionManager:
    """Tracks active sockets and serves them fire data via snapshots + deltas.

    Two caching layers keep this cheap under load:
      - `_registry` / `_registry_at`: a TTL-cached copy of *all* fires (unfiltered),
        used as the source for per-connection permission filtering instead of
        hitting the DB for every connect.
      - `_snap_payload` / `_snap_at`: a TTL-cached, already-serialized snapshot
        JSON string per scope, so simultaneous connects from the same scope
        don't each re-filter and re-serialize the fire list.
    """

    def __init__(self) -> None:
        self.active: list[Connection] = []
        self._registry: dict[str, dict] = {}
        self._registry_at: float = 0.0
        # Per-scope delta version counter, bumped on every broadcast so clients
        # can detect gaps/out-of-order delivery.
        self._version: dict[Tuple[str, ...], int] = {}
        self._snap_payload: dict[Tuple[str, ...], str] = {}
        self._snap_at: dict[Tuple[str, ...], float] = {}

    async def _scope_fires(self, conn: Connection) -> list[dict]:
        """Return the fires visible to `conn`, using the warm registry when fresh.

        Falls back to a direct, permission-aware DB query (`get_fires`) when
        the registry is empty or stale, so a connect never serves data older
        than one DB round trip even if the periodic warm-up hasn't run yet.
        """
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
        """Get the (possibly cached) full-snapshot payload for conn's scope."""
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
        """Accept a WebSocket, register it, and push the initial fires_snapshot.

        Args:
            ws: The FastAPI WebSocket to accept (must not already be accepted).
            user: The authenticated viewer; drives visibility scoping.
            paths: ltree region paths the user is restricted to (ignored for supers).
            can_view_officers: Whether this connection should also receive
                officer-related broadcasts (see officers/_helpers.py).

        Returns:
            The newly created Connection, appended to self.active.
        """
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
        """Push a fresh (non-cached-payload) snapshot to a single connection."""
        await conn.ws.send_text(
            self._snapshot_json(conn, await self._scope_fires(conn))
        )

    def disconnect(self, ws: WebSocket) -> None:
        """Remove a socket from the active list; safe to call even if already removed."""
        self.active = [c for c in self.active if c.ws is not ws]

    @staticmethod
    def diff_fires(
        old: dict[str, dict], new_list: list[dict]
    ) -> Tuple[list[dict], list[dict]]:
        """Compute what changed between the previous registry and a fresh fetch.

        Args:
            old: Previous registry, keyed by fire id.
            new_list: Freshly fetched, unfiltered list of all fires.

        Returns:
            (upserts, removed): fires that are new or changed (by value
            inequality, not just id), and fires present in `old` but absent
            from `new_list`.
        """
        new_by_id = {f["id"]: f for f in new_list}
        upserts = [f for fid, f in new_by_id.items() if old.get(fid) != f]
        removed = [old_f for fid, old_f in old.items() if fid not in new_by_id]
        return upserts, removed

    @staticmethod
    def route_delta(
        scope_paths, is_super: bool, upserts: list[dict], removed: list[dict]
    ) -> Tuple[list[dict], list[str]]:
        """Reduce a global diff to what a specific scope is actually allowed to see.

        A removal is only sent if the removed fire itself would have been
        visible to that scope (avoids leaking existence of out-of-scope fires
        via their absence).
        """
        vis_up = filter_fires(scope_paths, upserts, is_super)
        vis_rm = [f["id"] for f in filter_fires(scope_paths, removed, is_super)]
        return vis_up, vis_rm

    def warm_registry_from(self, new_list: list[dict]) -> None:
        """Replace the cached full fire registry and reset its TTL clock."""
        self._registry = {f["id"]: f for f in new_list}
        self._registry_at = time.monotonic()

    async def warm_registry(self) -> None:
        """Populate the registry cache on startup; failures are logged, not raised,
        so a transient DB hiccup doesn't prevent the app from booting."""
        try:
            self.warm_registry_from(await get_fires(user=None))
        except Exception as exc:
            print(f"[ws] registry warm failed: {exc}")

    async def refresh_and_broadcast_deltas(self) -> None:
        """Refetch all fires, diff against the cache, and push per-scope deltas.

        Triggered by Postgres NOTIFY events (see pg_listener.py) rather than
        polling. Snapshot caches are invalidated unconditionally on any real
        change so the next connect/reconnect sees up-to-date data instead of
        a stale cached snapshot.
        """
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
            # All members of a scope group share identical visibility, so the
            # first member's paths/is_super represent the whole group.
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


# Module-level singleton: one manager shared by the WS router, the Postgres
# listener, and admin broadcast helpers.
manager = ConnectionManager()
