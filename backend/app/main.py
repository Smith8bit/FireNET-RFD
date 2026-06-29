import asyncio
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .auth.authen import fastapi_users
from .config import get_settings
from .middleware import install_rate_limiting
from .database import Base, engine
from .database.schemas import UserCreate, UserRead, UserUpdate
from . import storage
from .database.seed import run_all as run_seed
from .db_control.fires import expire_old_fires, sweep_orphan_images, update_fires
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

# App logs go through the stdlib logging module (levels, no PII): request-time
# code logs ids, never raw emails — emails belong only in the audit_log.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("firenet")

scheduler = AsyncIOScheduler(timezone=settings.INGEST_TIMEZONE)

# A fixed key for the bootstrap advisory lock. Workers/replicas starting at once
# would otherwise race the idempotent DDL below (CREATE INDEX, triggers,
# create_all) into a deadlock; a transaction-level advisory lock serializes them
# and is released automatically when the bootstrap transaction commits. The same
# key is reused by the pg_listener trigger setup. (Until migrations exist — see
# audit M5 — this is the in-stack, zero-dependency guard.)
BOOTSTRAP_LOCK_KEY = 845_173_001

# upgrade a pre-existing non-unique index to unique (first-come-first-served จอง);
# no-op once the unique index is in place
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

# the audit trail is append-only: block UPDATE/DELETE at the DB level.
# the one permitted mutation is the ON DELETE SET NULL cascade that anonymizes a
# deleted account's rows (actor_id -> NULL, every other column untouched). The
# denormalized actor_email keeps those rows attributable, so the trail is preserved.
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
    try:
        await update_fires()
    except Exception as exc:
        logger.warning("ingest fetch failed (will retry on schedule): %s", exc)
    try:
        await expire_old_fires()
    except Exception as exc:
        logger.warning("ingest expiry failed (will retry on schedule): %s", exc)


async def _safe_sweep_orphans() -> None:
    try:
        await sweep_orphan_images()
    except Exception as exc:
        logger.warning("orphan sweep failed (will retry tomorrow): %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        # serialize bootstrap DDL across workers (auto-released on commit)
        await conn.execute(
            text("SELECT pg_advisory_xact_lock(:k)").bindparams(k=BOOTSTRAP_LOCK_KEY)
        )
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS ltree"))
        # Geography columns (firespots/field_officers) need PostGIS. The postgis
        # image enables it on first volume init, but create it here too so a fresh
        # or externally-managed DB can't fail create_all. Idempotent.
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text(_UNIQUE_FIRE_INDEX_SQL))
        # pre-existing tables don't get new model columns from create_all
        await conn.execute(
            text("ALTER TABLE firespots ADD COLUMN IF NOT EXISTS expired boolean NOT NULL DEFAULT false")
        )
        await conn.execute(
            text("ALTER TABLE firespots ADD COLUMN IF NOT EXISTS false_alarm boolean NOT NULL DEFAULT false")
        )
        await conn.execute(
            text("ALTER TABLE fire_resolutions ADD COLUMN IF NOT EXISTS officer_name text")
        )
        await conn.execute(
            text('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS division text')
        )
        await conn.execute(
            text("ALTER TABLE user_regions ADD COLUMN IF NOT EXISTS "
                 "permissions text[] NOT NULL DEFAULT '{}'")
        )
        await conn.execute(
            text("ALTER TABLE user_regions ADD COLUMN IF NOT EXISTS "
                 "created_at timestamptz NOT NULL DEFAULT now()")
        )
        await conn.execute(
            text("ALTER TABLE field_officers ADD COLUMN IF NOT EXISTS "
                 "appointed boolean NOT NULL DEFAULT false")
        )
        # backfill the snapshot for rows predating the column, so a later officer
        # delete doesn't strip their attribution (no-op once filled)
        await conn.execute(text(
            "UPDATE fire_resolutions r SET officer_name = fo.name FROM field_officers fo "
            "WHERE r.officer_id = fo.id AND r.officer_name IS NULL"
        ))
        await conn.execute(text(_AUDIT_BLOCK_FN_SQL))
        await conn.execute(text(_AUDIT_BLOCK_TRIGGER_SQL))
        # at most one open region-change request per officer
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_region_change_one_pending "
            "ON region_change_requests (user_id) WHERE status = 'pending'"
        ))
    await run_seed()
    try:
        await storage.ensure_bucket()
    except Exception as exc:
        # resolve-with-evidence will 502 until storage is back; don't block startup
        logger.warning("storage bucket check failed (%s); is MinIO running?", exc)
    if settings.INGEST_ENABLED:
        # fire-and-forget the boot ingest: a slow/unreachable feed (e.g. a
        # colocated feed not yet up, or NAT-hairpin on its public hostname) must
        # not block the app from accepting connections. When it lands, the
        # firespots insert trigger drives a delta to connected clients anyway.
        # ponytail: held on app.state so the task isn't GC'd mid-flight.
        app.state.boot_ingest = asyncio.create_task(_ingest_tick())
        scheduler.add_job(_ingest_tick, "interval", minutes=settings.INGEST_INTERVAL_MINUTES)
        scheduler.add_job(_safe_sweep_orphans, "interval", hours=24)
        scheduler.start()
    await pg_listener.start()
    # prime the fire registry so the first change after boot sends a minimal
    # delta (not the whole list) to already-connected clients
    await manager.warm_registry()
    yield
    await pg_listener.stop()
    if scheduler.running:
        scheduler.shutdown(wait=False)


app = FastAPI(title="FireNET API", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

# Throttle credential brute force / registration abuse on the auth endpoints.
# Registered BEFORE CORS so that CORS ends up the outermost middleware: Starlette
# runs the last-added middleware first, and CORS must wrap every response —
# including the limiter's early 429 — or the browser sees a cross-origin reply
# with no Access-Control-Allow-Origin header and reports it as a CORS failure
# instead of letting the client read the 429.
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

# login / refresh / logout for both web (cookie) and mobile (bearer); issues and
# rotates the refresh token alongside the short-lived access token
app.include_router(auth_router, prefix="/auth", tags=["auth"])
app.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    prefix="/auth",
    tags=["auth"],
)
# our users routes first so static paths (e.g. /users/list) aren't shadowed by
# fastapi-users' /users/{id} param route
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
app.include_router(ws_router, tags=["ws"])


@app.get("/")
def read_root():
    return {"service": "firenet", "status": "ok"}


# MapLibre's offline pack downloader fetches the style by URL through its own HTTP
# stack (no bearer token), so this must be public. ponytail: kept in sync by hand
# with mobile/assets/layers/base.json — only the raster tile URLs need to match
# (the offline cache keys tiles by URL), and they change ~never.
_MAP_STYLE = {
    "version": 8,
    "sources": {
        "raster-tiles": {
            "type": "raster",
            "tiles": [
                "https://mt0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
                "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
                "https://mt2.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
                "https://mt3.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
            ],
            "tileSize": 256,
            "attribution": "&copy; <a href='https://maps.google.com'>Google Maps</a> contributors",
        }
    },
    "layers": [{"id": "raster-layer", "type": "raster", "source": "raster-tiles"}],
}


@app.get("/map-style.json")
def map_style():
    return _MAP_STYLE
