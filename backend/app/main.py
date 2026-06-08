import uuid

from contextlib import asynccontextmanager
from typing import Tuple

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from .auth.authen import auth_backend, fastapi_users
from .config import get_settings
from .database import Base, async_session_maker, engine
from .database.models import Region, User, UserRegion
from .db_control.fires import get_fires, update_fires
from .db_control.permission import fire_visible, user_region_paths
from .router.regions import router as regions_router
from .database.schemas import UserCreate, UserRead, UserUpdate
from .database.seed import run_all as run_seed
from .auth.ws_auth import get_user_from_ws
from .router.officers import router as officers_router
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
app.include_router(regions_router, prefix="/regions", tags=["regions"])
app.include_router(officers_router, prefix="/officers", tags=["officers"])

class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[Tuple[WebSocket, User]] = []

    async def connect(self, ws: WebSocket, user: User) -> None:
        await ws.accept()
        self.active.append((ws, user))
        fires = await get_fires(user=user)
        await ws.send_json({"fires": fires})

    def disconnect(self, ws: WebSocket) -> None:
        self.active = [(s, u) for (s, u) in self.active if s is not ws]

    async def broadcast(self, fire: dict) -> None:
        path = fire.get("path", "")
        async with async_session_maker() as session:
            for ws, user in list(self.active):
                if await fire_visible(user, path, session):
                    await ws.send_json(fire)


manager = ConnectionManager()


_PENDING_SQL = """
    SELECT u.id AS user_id, u.email AS email,
           r.name_th AS province_name_th, r.path::text AS province_path
    FROM "user" u
    JOIN user_regions ur ON ur.user_id = u.id AND ur.role = 'field_officer'
    JOIN regions r ON r.id = ur.region_id
    WHERE u.is_verified = false
"""


async def _is_admin(user: User, session) -> bool:
    if user.is_superuser:
        return True
    roles = (
        await session.execute(select(UserRegion.role).where(UserRegion.user_id == user.id))
    ).scalars().all()
    return any(r != "field_officer" for r in roles)


async def _handle_list_pending(ws: WebSocket, user: User) -> None:
    async with async_session_maker() as session:
        if not await _is_admin(user, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        if user.is_superuser:
            rows = await session.execute(text(_PENDING_SQL + " ORDER BY u.email"))
        else:
            paths = await user_region_paths(user, session)
            if not paths:
                await ws.send_json({"type": "pending_officers", "officers": []})
                return
            rows = await session.execute(
                text(_PENDING_SQL + " AND r.path <@ ANY(CAST(:paths AS ltree[])) ORDER BY u.email")
                .bindparams(paths=paths)
            )
        officers = [
            {
                "user_id": str(m["user_id"]),
                "email": m["email"],
                "province_name_th": m["province_name_th"],
                "province_path": m["province_path"],
            }
            for m in rows.mappings().all()
        ]
    await ws.send_json({"type": "pending_officers", "officers": officers})


async def _handle_verify_officer(ws: WebSocket, admin: User, data: dict) -> None:
    try:
        user_id = uuid.UUID(data["user_id"])
    except (KeyError, ValueError):
        await ws.send_json({"type": "error", "code": "invalid_user_id"})
        return

    async with async_session_maker() as session:
        if not await _is_admin(admin, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return

        province_path = (
            await session.execute(
                select(Region.path)
                .join(UserRegion, UserRegion.region_id == Region.id)
                .where(UserRegion.user_id == user_id, UserRegion.role == "field_officer")
            )
        ).scalar_one_or_none()
        if province_path is None:
            await ws.send_json({"type": "error", "code": "not_found"})
            return

        if not admin.is_superuser:
            ok = await session.execute(
                text(
                    "SELECT 1 FROM regions r JOIN user_regions ur ON ur.region_id = r.id "
                    "WHERE ur.user_id = :aid AND CAST(:p AS ltree) <@ r.path LIMIT 1"
                ).bindparams(aid=admin.id, p=province_path)
            )
            if ok.first() is None:
                await ws.send_json({"type": "error", "code": "out_of_scope"})
                return

        target = await session.get(User, user_id)
        target.is_verified = True
        await session.commit()

    await ws.send_json({"type": "officer_verified", "user_id": str(user_id)})


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    user = await get_user_from_ws(ws)
    if user is None:
        await ws.close(code=1008)
        return
    await manager.connect(ws, user)
    try:
        while True:
            data = await ws.receive_json()
            msg_type = data.get("type")
            if msg_type == "list_pending_officers":
                await _handle_list_pending(ws, user)
            elif msg_type == "verify_officer":
                await _handle_verify_officer(ws, user, data)
            else:
                print(f"[ws/{user.email}] {data}")
    except WebSocketDisconnect:
        manager.disconnect(ws)


@app.get("/")
def read_root():
    return {"service": "tfms", "status": "ok"}

