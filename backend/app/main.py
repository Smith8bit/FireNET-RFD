from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .auth.authen import auth_backend, fastapi_users
from .config import get_settings
from .database import Base, engine
from .database.schemas import UserCreate, UserRead, UserUpdate
from .database.seed import run_all as run_seed
from .db_control.fires import update_fires
from .router.fires import router as fires_router
from .router.regions import router as regions_router
from .router.officers import router as officers_router
from .router.users import router as users_router
from .router.ws import router as ws_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS ltree"))
        await conn.run_sync(Base.metadata.create_all)
    await run_seed()
    await update_fires()
    yield


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
