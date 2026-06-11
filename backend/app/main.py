from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .auth.authen import auth_backend, fastapi_users
from .config import get_settings
from .database import Base, engine
from .database.schemas import UserCreate, UserRead, UserUpdate
from . import storage
from .database.seed import run_all as run_seed
from .db_control.fires import expire_old_fires, sweep_orphan_images, update_fires
from .router.fires import router as fires_router
from .router.regions import router as regions_router
from .router.officers import router as officers_router
from .router.users import router as users_router
from .router.ws import router as ws_router
from .ws.pg_listener import pg_listener

settings = get_settings()

scheduler = AsyncIOScheduler(timezone=settings.INGEST_TIMEZONE)

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


async def _ingest_tick() -> None:
    try:
        await update_fires()
    except Exception as exc:
        print(f"[ingest] fetch failed (will retry on schedule): {exc}")
    try:
        await expire_old_fires()
    except Exception as exc:
        print(f"[ingest] expiry failed (will retry on schedule): {exc}")


async def _safe_sweep_orphans() -> None:
    try:
        await sweep_orphan_images()
    except Exception as exc:
        print(f"[sweep] orphan sweep failed (will retry tomorrow): {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS ltree"))
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text(_UNIQUE_FIRE_INDEX_SQL))
        # pre-existing tables don't get new model columns from create_all
        await conn.execute(
            text("ALTER TABLE firespots ADD COLUMN IF NOT EXISTS expired boolean NOT NULL DEFAULT false")
        )
    await run_seed()
    try:
        await storage.ensure_bucket()
    except Exception as exc:
        # resolve-with-evidence will 502 until storage is back; don't block startup
        print(f"[storage] bucket check failed ({exc}); is MinIO running?")
    if settings.INGEST_ENABLED:
        await _ingest_tick()
        scheduler.add_job(_ingest_tick, "interval", minutes=settings.INGEST_INTERVAL_MINUTES)
        scheduler.add_job(_safe_sweep_orphans, "interval", hours=24)
        scheduler.start()
    await pg_listener.start()
    yield
    await pg_listener.stop()
    if scheduler.running:
        scheduler.shutdown(wait=False)


app = FastAPI(title="TFMS API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/auth/cookie",
    tags=["auth"],
)
app.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    prefix="/auth",
    tags=["auth"],
)
app.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)
app.include_router(fires_router, prefix="/fires", tags=["fires"])
app.include_router(regions_router, prefix="/regions", tags=["regions"])
app.include_router(officers_router, prefix="/officers", tags=["officers"])
app.include_router(users_router, prefix="/users", tags=["users"])
app.include_router(ws_router, tags=["ws"])


@app.get("/")
def read_root():
    return {"service": "tfms", "status": "ok"}
