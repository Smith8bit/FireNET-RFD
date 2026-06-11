import asyncio

import asyncpg

from ..config import get_settings

settings = get_settings()

CHANNEL = "tfms_changes"
_DEBOUNCE_S = 0.5
_RECONNECT_S = 5

# Statement-level triggers: any committed change to these tables notifies the
# channel (payload = trigger argument, falling back to the table name). Payload
# stays tiny; listeners refetch the data they need, so visibility filtering
# keeps applying per user.
#
# field_officers is split in two so the 5-minute location pings (which can't
# change any fire's booked flag) only refresh the admin officer lists, while
# booking changes (fire_id) also refresh every client's fire list.
_TRIGGER_SQL = """
CREATE OR REPLACE FUNCTION tfms_notify_change() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('tfms_changes', COALESCE(TG_ARGV[0], TG_TABLE_NAME));
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tfms_notify_firespots ON firespots;
CREATE TRIGGER tfms_notify_firespots
    AFTER INSERT OR UPDATE OR DELETE ON firespots
    FOR EACH STATEMENT EXECUTE FUNCTION tfms_notify_change();

DROP TRIGGER IF EXISTS tfms_notify_field_officers ON field_officers;
DROP TRIGGER IF EXISTS tfms_notify_fo_booking ON field_officers;
CREATE TRIGGER tfms_notify_fo_booking
    AFTER INSERT OR DELETE OR UPDATE OF fire_id ON field_officers
    FOR EACH STATEMENT EXECUTE FUNCTION tfms_notify_change('field_officers_booking');

DROP TRIGGER IF EXISTS tfms_notify_fo_status ON field_officers;
CREATE TRIGGER tfms_notify_fo_status
    AFTER UPDATE ON field_officers
    FOR EACH STATEMENT EXECUTE FUNCTION tfms_notify_change();

DROP TRIGGER IF EXISTS tfms_notify_user ON "user";
CREATE TRIGGER tfms_notify_user
    AFTER INSERT OR UPDATE OR DELETE ON "user"
    FOR EACH STATEMENT EXECUTE FUNCTION tfms_notify_change();
"""


class PgListener:
    """LISTEN/NOTIFY bridge: DB changes -> fresh data pushed to ws clients."""

    def __init__(self) -> None:
        self._runner: asyncio.Task | None = None
        self._flusher: asyncio.Task | None = None
        self._pending: set[str] = set()
        self._stopping = False

    async def start(self) -> None:
        self._stopping = False
        self._runner = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stopping = True
        for task in (self._runner, self._flusher):
            if task is not None:
                task.cancel()

    async def _run(self) -> None:
        dsn = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
        while not self._stopping:
            try:
                conn = await asyncpg.connect(dsn)
                try:
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
                print(f"[pg_listener] connection lost ({exc}); retrying in {_RECONNECT_S}s")
                await asyncio.sleep(_RECONNECT_S)

    def _on_notify(self, _conn, _pid, _channel, payload: str) -> None:
        self._pending.add(payload)
        if self._flusher is None or self._flusher.done():
            self._flusher = asyncio.create_task(self._flush())

    async def _flush(self) -> None:
        # debounce so bursts (e.g. the daily ingest) become one refresh
        await asyncio.sleep(_DEBOUNCE_S)
        while True:
            tables, self._pending = set(self._pending), set()
            from .manager import manager
            from .officer_handlers import broadcast_admin_refresh

            try:
                # booking changes affect the fires' "booked" flag too
                if tables & {"firespots", "field_officers_booking"}:
                    await manager.broadcast_fires()
                if tables & {"field_officers", "field_officers_booking", "user"}:
                    await broadcast_admin_refresh(
                        manager.active, include_pending="user" in tables
                    )
            except Exception as exc:
                print(f"[pg_listener] broadcast failed: {exc}")
            if not self._pending:
                return


pg_listener = PgListener()
