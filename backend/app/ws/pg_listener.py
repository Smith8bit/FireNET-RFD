"""Bridges Postgres LISTEN/NOTIFY to the in-process WebSocket broadcast layer.

Rather than polling the DB, we install triggers that PG-NOTIFY on relevant
table changes; a single asyncpg connection listens for those notifications
and fans them out to `manager` / officer broadcast helpers. This lets other
processes (e.g. background jobs, admin scripts, or other API replicas writing
to the same DB) trigger live updates without going through this API instance
directly.
"""

import asyncio
import time

import asyncpg

from ..config import get_settings

settings = get_settings()

CHANNEL = "firenet_changes"
# Coalesce a burst of NOTIFYs (e.g. a bulk update touching many rows) into one
# broadcast instead of one per row/statement.
_DEBOUNCE_S = 0.5
_RECONNECT_S = 5
# Arbitrary fixed key for pg_advisory_xact_lock: ensures only one process at a
# time (re)installs the trigger/function DDL below, avoiding race conditions
# when multiple API instances start concurrently.
_BOOTSTRAP_LOCK_KEY = 845_173_001

# Idempotent DDL: (re)creates the notify function and attaches statement-level
# triggers to the tables whose changes matter to connected clients. Using
# FOR EACH STATEMENT (not ROW) means one notification per statement regardless
# of how many rows it touched, which keeps notification volume low for bulk
# operations; the payload only carries a table/topic tag, not row data, so
# listeners always re-fetch the authoritative state rather than trusting the
# notification body.
_TRIGGER_SQL = """
CREATE OR REPLACE FUNCTION firenet_notify_change() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('firenet_changes', COALESCE(TG_ARGV[0], TG_TABLE_NAME));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS firenet_notify_firespots ON firespots;
CREATE TRIGGER firenet_notify_firespots
    AFTER INSERT OR UPDATE OR DELETE ON firespots
    FOR EACH STATEMENT EXECUTE FUNCTION firenet_notify_change();
DROP TRIGGER IF EXISTS firenet_notify_field_officers ON field_officers;
DROP TRIGGER IF EXISTS firenet_notify_fo_booking ON field_officers;
CREATE TRIGGER firenet_notify_fo_booking
    AFTER INSERT OR DELETE OR UPDATE OF fire_id ON field_officers
    FOR EACH STATEMENT EXECUTE FUNCTION firenet_notify_change('field_officers_booking');
DROP TRIGGER IF EXISTS firenet_notify_fo_status ON field_officers;
CREATE TRIGGER firenet_notify_fo_status
    AFTER UPDATE ON field_officers
    FOR EACH STATEMENT EXECUTE FUNCTION firenet_notify_change();
DROP TRIGGER IF EXISTS firenet_notify_user ON "user";
CREATE TRIGGER firenet_notify_user
    AFTER INSERT OR UPDATE OR DELETE ON "user"
    FOR EACH STATEMENT EXECUTE FUNCTION firenet_notify_change();
"""


class PgListener:
    """Owns the long-lived LISTEN connection and the debounce/dispatch logic."""

    def __init__(self) -> None:
        self._runner: asyncio.Task | None = None
        self._flusher: asyncio.Task | None = None
        self._pending: set[str] = set()  # notification payloads seen since last flush
        self._stopping = False
        self._last_officer_refresh = 0.0
        self._officer_trailing: asyncio.Task | None = None

    async def start(self) -> None:
        self._stopping = False
        self._runner = asyncio.create_task(self._run())

    async def stop(self) -> None:
        """Signal shutdown and cancel any in-flight background tasks."""
        self._stopping = True
        for task in (self._runner, self._flusher, self._officer_trailing):
            if task is not None:
                task.cancel()

    async def _run(self) -> None:
        """Maintain the LISTEN connection, reconnecting on failure.

        asyncpg's LISTEN model requires a dedicated connection that stays open
        indefinitely; there's no blocking "wait for notify" call, so this loop
        just sleeps and periodically checks conn.is_closed() to detect drops
        (notifications themselves arrive via the _on_notify callback, not by
        polling here).
        """
        # asyncpg needs the plain postgresql:// scheme, not the SQLAlchemy
        # +asyncpg driver suffix used elsewhere in the app.
        dsn = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
        while not self._stopping:
            try:
                conn = await asyncpg.connect(dsn)
                try:
                    async with conn.transaction():
                        # Serialize DDL install across concurrent processes/instances.
                        await conn.execute(
                            "SELECT pg_advisory_xact_lock($1)", _BOOTSTRAP_LOCK_KEY
                        )
                        await conn.execute(_TRIGGER_SQL)
                    await conn.add_listener(CHANNEL, self._on_notify)
                    print(f"[pg_listener] listening on '{CHANNEL}'")
                    while not conn.is_closed():
                        await asyncio.sleep(_RECONNECT_S)
                finally:
                    if not conn.is_closed():
                        await conn.close()
            except asyncio.CancelledError:
                return
            except Exception as exc:
                print(
                    f"[pg_listener] connection lost ({exc}); retrying in {_RECONNECT_S}s"
                )
                await asyncio.sleep(_RECONNECT_S)

    def _on_notify(self, _conn, _pid, _channel, payload: str) -> None:
        """asyncpg callback (sync, fired on the event loop) for each NOTIFY.

        Just records the topic and (re)starts the debounce flusher if it's
        not already running; the callback itself must stay non-blocking.
        """
        self._pending.add(payload)
        if self._flusher is None or self._flusher.done():
            self._flusher = asyncio.create_task(self._flush())

    async def _flush(self) -> None:
        """Wait out the debounce window, then broadcast based on which tables changed.

        Loops until `_pending` is empty at the end of a pass, so notifications
        that arrive *during* processing of a previous batch aren't dropped.
        """
        await asyncio.sleep(_DEBOUNCE_S)
        while True:
            tables, self._pending = set(self._pending), set()
            # Imported lazily to avoid a circular import (manager imports from
            # this package's __init__, which would otherwise import pg_listener).
            from .manager import manager

            try:
                if tables & {"firespots", "field_officers_booking"}:
                    await manager.refresh_and_broadcast_deltas()
                if tables & {"field_officers_booking", "user"}:
                    # A booking or user change always warrants an immediate,
                    # unthrottled officer refresh (including pending list if a
                    # user row changed, since that can affect verification state).
                    await self._refresh_officers(include_pending="user" in tables)
                elif "field_officers" in tables:
                    # Non-booking field_officer changes (e.g. location pings)
                    # are high-frequency, so they're rate-limited instead.
                    await self._maybe_refresh_officers()
            except Exception as exc:
                print(f"[pg_listener] broadcast failed: {exc}")
            if not self._pending:
                return

    async def _refresh_officers(self, include_pending: bool = False) -> None:
        from .manager import manager
        from .officers import broadcast_admin_refresh

        if not manager.active:
            return
        self._last_officer_refresh = time.monotonic()
        await broadcast_admin_refresh(manager.active, include_pending=include_pending)

    async def _maybe_refresh_officers(self) -> None:
        """Throttle high-frequency officer updates to at most once per interval.

        If the interval has already elapsed, refresh immediately. Otherwise,
        schedule a single trailing refresh for when the interval next elapses
        (so the *last* update in a burst is never permanently dropped, even if
        no further notifications arrive after it).
        """
        interval = settings.OFFICER_REFRESH_INTERVAL_SECONDS
        elapsed = time.monotonic() - self._last_officer_refresh
        if elapsed >= interval:
            await self._refresh_officers()
        elif self._officer_trailing is None or self._officer_trailing.done():
            self._officer_trailing = asyncio.create_task(
                self._trailing_refresh(interval - elapsed)
            )

    async def _trailing_refresh(self, delay: float) -> None:
        try:
            await asyncio.sleep(delay)
            await self._refresh_officers()
        except asyncio.CancelledError:
            pass


# Module-level singleton, started/stopped from the app lifespan.
pg_listener = PgListener()
