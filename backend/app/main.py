from contextlib import asynccontextmanager
from typing import Tuple

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .auth.authen import auth_backend, fastapi_users
from .config import get_settings
from .database import Base, async_session_maker, engine
from .database.models import User
from .db_control.permission import fire_visible
from .router.firemap import router as fires_router
from .router.regions import router as regions_router
from .database.schemas import UserCreate, UserRead, UserUpdate
from .database.seed import run_all as run_seed
from .auth.ws_auth import get_user_from_ws

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS ltree"))
        await conn.run_sync(Base.metadata.create_all)
    await run_seed()
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
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)
app.include_router(regions_router, prefix="/regions", tags=["regions"])
app.include_router(fires_router, prefix="/fires", tags=["fires"])


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[Tuple[WebSocket, User]] = []

    async def connect(self, ws: WebSocket, user: User) -> None:
        await ws.accept()
        self.active.append((ws, user))

    def disconnect(self, ws: WebSocket) -> None:
        self.active = [(s, u) for (s, u) in self.active if s is not ws]

    async def broadcast(self, fire: dict) -> None:
        path = fire.get("path", "")
        async with async_session_maker() as session:
            for ws, user in list(self.active):
                if await fire_visible(user, path, session):
                    await ws.send_json(fire)


manager = ConnectionManager()


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
            print(f"[ws/{user.email}] {data}")
    except WebSocketDisconnect:
        manager.disconnect(ws)


@app.get("/")
def read_root():
    return {"service": "tfms", "status": "ok"}