import asyncio
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from . import storage
from .auth.authen import fastapi_users
from .config import get_settings
from .middleware import install_rate_limiting
from .database import Base, engine
from .database.schemas import UserCreate, UserRead, UserUpdate
from .database.seed import run_all as run_seed
from .db_control.fires import expire_old_fires, sweep_orphan_images
from .db_control.firefetch import update_fires
from .router.app_update import router as app_update_router
from .router.audit import router as audit_router
from .router.auth import router as auth_router
from .router.fires import router as fires_router
from .router.regions import router as regions_router
from .router.officers import router as officers_router
from .router.users import router as users_router
from .router.ws import router as ws_router
from .ws.manager import manager
from .ws.pg_listener import pg_listener

settings = get_settings()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("firenet")

scheduler = AsyncIOScheduler(timezone=settings.INGEST_TIMEZONE)

# Arbitrary fixed key for pg_advisory_xact_lock: any int works as long as it's stable, so that
# concurrent app instances starting up simultaneously serialize their schema bootstrap instead
# of racing on CREATE TABLE / ALTER TABLE / CREATE INDEX statements.
BOOTSTRAP_LOCK_KEY = 845_173_001

_ORPHAN_SWEEP_HOURS = 24
_WS_SNAPSHOT_VERSION = 8
_MAP_TILE_SIZE = 256

# Idempotent DDL run on every boot (instead of a migration framework): safe to re-execute
# because each statement guards itself with IF NOT EXISTS / EXISTS checks, so a fleet of
# instances can all run this on startup without conflicting or erroring on re-application.
_UNIQUE_FIRE_INDEX_SQL = """
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE indexname = 'ix_field_officer_fire_id'
          AND indexdef LIKE 'CREATE UNIQUE INDEX%'
    ) THEN
        DROP INDEX IF EXISTS ix_field_officer_fire_id;
        CREATE UNIQUE INDEX ix_field_officer_fire_id ON field_officers (fire_id);
    END IF;
END $$;
"""

# Enforces append-only semantics for audit_log at the database level (not just app-level
# discipline): a trigger raises on any UPDATE/DELETE, except it tolerates the narrow no-op
# UPDATE case (all business columns unchanged) so ORM round-trips that re-save an unmodified
# row don't spuriously fail.
_AUDIT_BLOCK_FN_SQL = """
CREATE OR REPLACE FUNCTION audit_log_block_mutation() RETURNS trigger AS $fn$
BEGIN
    IF TG_OP = 'UPDATE'
       AND OLD.actor_id IS NOT NULL
       AND NEW.actor_id IS NULL
       AND NEW.actor_email IS NOT DISTINCT FROM OLD.actor_email
       AND NEW.action      IS NOT DISTINCT FROM OLD.action
       AND NEW.entity_type IS NOT DISTINCT FROM OLD.entity_type
       AND NEW.entity_id   IS NOT DISTINCT FROM OLD.entity_id
       AND NEW.detail      IS NOT DISTINCT FROM OLD.detail
       AND NEW.at          IS NOT DISTINCT FROM OLD.at
       AND NEW.id          IS NOT DISTINCT FROM OLD.id THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'audit_log is append-only';
END;
$fn$ LANGUAGE plpgsql
"""

_AUDIT_BLOCK_TRIGGER_SQL = """
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_audit_log_append_only') THEN
        CREATE TRIGGER trg_audit_log_append_only
            BEFORE UPDATE OR DELETE ON audit_log
            FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();
    END IF;
END $$;
"""


async def _ingest_tick() -> None:
    """Scheduled job body: fetch fresh fire data, then expire stale rows.

    Each step is wrapped in its own try/except so a failure in one (e.g. the upstream
    wildfire API being down) does not prevent the other from running, and does not crash
    the scheduler — the job simply retries on the next scheduled interval.
    """
    try:
        await update_fires()
    except Exception as exc:
        logger.warning("ingest fetch failed (will retry on schedule): %s", exc)
    try:
        await expire_old_fires()
    except Exception as exc:
        logger.warning("ingest expiry failed (will retry on schedule): %s", exc)


async def _safe_sweep_orphans() -> None:
    """Scheduled job wrapper: never let an S3/MinIO cleanup failure kill the scheduler thread."""
    try:
        await sweep_orphan_images()
    except Exception as exc:
        logger.warning("orphan sweep failed (will retry tomorrow): %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI startup/shutdown hook: runs schema bootstrap, seeding, and background jobs.

    Args:
        app: The FastAPI instance being started (unused here beyond the decorator contract,
            but required by ASGI's lifespan signature; app.state is used later to stash the
            boot-time ingest task handle).
    Yields:
        Control back to FastAPI to serve requests; code after `yield` runs on shutdown.
    """
    async with engine.begin() as conn:
        # Take a transaction-scoped advisory lock first so that if multiple app replicas boot
        # concurrently, only one runs the DDL/backfill block below at a time; the lock is
        # released automatically when the transaction (this `async with`) ends.
        await conn.execute(
            text("SELECT pg_advisory_xact_lock(:k)").bindparams(k=BOOTSTRAP_LOCK_KEY)
        )
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS ltree"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        # create_all only creates tables that don't yet exist; it never alters existing ones.
        # The ALTER TABLE ... ADD COLUMN IF NOT EXISTS statements below are this project's
        # lightweight substitute for a migration framework, backfilling new columns onto
        # tables that already existed from a prior deploy.
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text(_UNIQUE_FIRE_INDEX_SQL))
        await conn.execute(
            text(
                "ALTER TABLE firespots ADD COLUMN IF NOT EXISTS expired boolean NOT NULL DEFAULT false"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE firespots ADD COLUMN IF NOT EXISTS false_alarm boolean NOT NULL DEFAULT false"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE fire_resolutions ADD COLUMN IF NOT EXISTS officer_name text"
            )
        )
        await conn.execute(
            text('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS division text')
        )
        await conn.execute(
            text(
                "ALTER TABLE user_regions ADD COLUMN IF NOT EXISTS "
                "permissions text[] NOT NULL DEFAULT '{}'"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE user_regions ADD COLUMN IF NOT EXISTS "
                "created_at timestamptz NOT NULL DEFAULT now()"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE field_officers ADD COLUMN IF NOT EXISTS "
                "appointed boolean NOT NULL DEFAULT false"
            )
        )
        # One-time backfill for the officer_name column just added above: copies the officer's
        # current name onto existing resolution rows so historical records display a name even
        # though the column didn't exist when they were created. Guarded by IS NULL so it's
        # safe to re-run on every boot without overwriting already-backfilled rows.
        await conn.execute(
            text(
                "UPDATE fire_resolutions r SET officer_name = fo.name FROM field_officers fo "
                "WHERE r.officer_id = fo.id AND r.officer_name IS NULL"
            )
        )
        await conn.execute(text(_AUDIT_BLOCK_FN_SQL))
        await conn.execute(text(_AUDIT_BLOCK_TRIGGER_SQL))
        await conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_region_change_one_pending "
                "ON region_change_requests (user_id) WHERE status = 'pending'"
            )
        )
    await run_seed()
    try:
        await storage.ensure_bucket()
    except Exception as exc:
        # Non-fatal: the API can still serve most routes without object storage available;
        # only evidence photo/video upload/download would fail until MinIO comes up.
        logger.warning("storage bucket check failed (%s); is MinIO running?", exc)
    if settings.INGEST_ENABLED:
        # Fire an immediate ingest on boot (don't wait for the first scheduler interval to
        # elapse) in addition to registering the recurring interval jobs, so the map has
        # fresh data right after a deploy/restart rather than sitting stale for up to
        # INGEST_INTERVAL_MINUTES.
        app.state.boot_ingest = asyncio.create_task(_ingest_tick())
        scheduler.add_job(
            _ingest_tick, "interval", minutes=settings.INGEST_INTERVAL_MINUTES
        )
        scheduler.add_job(_safe_sweep_orphans, "interval", hours=_ORPHAN_SWEEP_HOURS)
        scheduler.start()
    await pg_listener.start()
    # Pre-populate in-memory websocket/presence state from the DB so the first clients to
    # connect after a restart see correct data immediately instead of an empty registry.
    await manager.warm_registry()
    yield
    # Shutdown: stop listening for DB notifications and tear down the scheduler without
    # blocking on currently-running jobs (wait=False), since the process is exiting anyway.
    await pg_listener.stop()
    if scheduler.running:
        scheduler.shutdown(wait=False)


# docs_url/redoc_url/openapi_url disabled: schema/docs endpoints are not exposed publicly
# in this deployment (reduces attack-surface / information disclosure in production).
app = FastAPI(
    title="FireNET API",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

install_rate_limiting(
    app,
    limit=settings.RATE_LIMIT_MAX,
    window_seconds=settings.RATE_LIMIT_WINDOW_SECONDS,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    prefix="/auth",
    tags=["auth"],
)
app.include_router(users_router, prefix="/users", tags=["users"])
app.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)
app.include_router(fires_router, prefix="/fires", tags=["fires"])
app.include_router(regions_router, prefix="/regions", tags=["regions"])
app.include_router(officers_router, prefix="/officers", tags=["officers"])
app.include_router(audit_router, prefix="/audit", tags=["audit"])
app.include_router(app_update_router, prefix="/app", tags=["app-update"])
app.include_router(ws_router, tags=["ws"])


@app.get("/")
def read_root():
    """Unauthenticated liveness/health-check endpoint."""
    return {"service": "firenet", "status": "ok"}


# Static MapLibre/Mapbox GL style document served to the frontend map client, sourcing
# raster tiles from multiple Google Maps subdomains (mt0-mt3) to allow browsers to open
# more parallel connections than a single hostname permits.
_MAP_STYLE = {
    "version": _WS_SNAPSHOT_VERSION,
    "sources": {
        "raster-tiles": {
            "type": "raster",
            "tiles": [
                "https://mt0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
                "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
                "https://mt2.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
                "https://mt3.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
            ],
            "tileSize": _MAP_TILE_SIZE,
            "attribution": "&copy; <a href='https://maps.google.com'>Google Maps</a> contributors",
        }
    },
    "layers": [{"id": "raster-layer", "type": "raster", "source": "raster-tiles"}],
}


@app.get("/map-style.json")
def map_style():
    """Return the static map style JSON consumed by the frontend map renderer."""
    return _MAP_STYLE
