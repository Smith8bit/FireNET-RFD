import asyncio
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

import storage
from .auth.authen import fastapi_users
from .config import get_settings
from .middleware import install_rate_limiting
from .database import Base, engine
from .database.schemas import UserCreate, UserRead, UserUpdate
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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("firenet")

scheduler = AsyncIOScheduler(timezone=settings.INGEST_TIMEZONE)

BOOTSTRAP_LOCK_KEY = 845_173_001

_ORPHAN_SWEEP_HOURS = 24
_WS_SNAPSHOT_VERSION = 8
_MAP_TILE_SIZE = 256

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
        await conn.execute(
            text("SELECT pg_advisory_xact_lock(:k)").bindparams(k=BOOTSTRAP_LOCK_KEY)
        )
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS ltree"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
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
        logger.warning("storage bucket check failed (%s); is MinIO running?", exc)
    if settings.INGEST_ENABLED:
        app.state.boot_ingest = asyncio.create_task(_ingest_tick())
        scheduler.add_job(
            _ingest_tick, "interval", minutes=settings.INGEST_INTERVAL_MINUTES
        )
        scheduler.add_job(_safe_sweep_orphans, "interval", hours=_ORPHAN_SWEEP_HOURS)
        scheduler.start()
    await pg_listener.start()
    await manager.warm_registry()
    yield
    await pg_listener.stop()
    if scheduler.running:
        scheduler.shutdown(wait=False)


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
app.include_router(ws_router, tags=["ws"])


@app.get("/")
def read_root():
    return {"service": "firenet", "status": "ok"}


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
    return _MAP_STYLE
