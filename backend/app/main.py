import uuid

from contextlib import asynccontextmanager
from typing import Tuple

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from .auth.authen import auth_backend, fastapi_users
from .config import get_settings
from .database import Base, async_session_maker, engine
from .database.models import FieldOfficer, Region, User, UserRegion
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


_OFFICERS_SQL = """
    SELECT fo.id AS field_officer_id, fo.user_id, u.email,
           fo.active, fo.fire_id::text AS fire_id,
           fo.last_updated::text AS last_updated,
           r.name_th AS province_name_th, r.path::text AS province_path
    FROM field_officers fo
    JOIN "user" u ON u.id = fo.user_id
    JOIN user_regions ur ON ur.user_id = fo.user_id AND ur.role = 'field_officer'
    JOIN regions r ON r.id = ur.region_id
    WHERE u.is_verified = true
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


async def _fetch_officers(session, user: User) -> list[dict]:
    if user.is_superuser:
        rows = await session.execute(text(_OFFICERS_SQL + " ORDER BY u.email"))
    else:
        paths = await user_region_paths(user, session)
        if not paths:
            return []
        rows = await session.execute(
            text(_OFFICERS_SQL + " AND r.path <@ ANY(CAST(:paths AS ltree[])) ORDER BY u.email")
            .bindparams(paths=paths)
        )
    return [
        {
            "field_officer_id": str(m["field_officer_id"]),
            "user_id": str(m["user_id"]),
            "email": m["email"],
            "active": m["active"],
            "fire_id": m["fire_id"],
            "last_updated": m["last_updated"],
            "province_name_th": m["province_name_th"],
            "province_path": m["province_path"],
        }
        for m in rows.mappings().all()
    ]


async def _handle_list_officers(ws: WebSocket, user: User) -> None:
    async with async_session_maker() as session:
        if not await _is_admin(user, session):
            await ws.send_json({"type": "error", "code": "forbidden"})
            return
        officers = await _fetch_officers(session, user)
    print(f"[officers] list_officers requested by {user.email}: {len(officers)} officers found")
    await ws.send_json({"type": "officers_in_region", "officers": officers})


async def _broadcast_officers_update() -> None:
    """Push updated officer lists to all connected admins after a verification."""
    async with async_session_maker() as session:
        for ws, user in list(manager.active):
            try:
                if not await _is_admin(user, session):
                    continue
                officers = await _fetch_officers(session, user)
                print(f"[broadcast] officers_in_region → {user.email}: {len(officers)} officers")
                await ws.send_json({"type": "officers_in_region", "officers": officers})
            except Exception as exc:
                print(f"[broadcast] failed to send to {user.email}: {exc}")


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

        existing_fo = (
            await session.execute(select(FieldOfficer).where(FieldOfficer.user_id == user_id))
        ).scalar_one_or_none()
        if existing_fo is None:
            session.add(FieldOfficer(user_id=user_id))
            print(f"[verify] created FieldOfficer for user {user_id}")
        else:
            print(f"[verify] FieldOfficer already exists for user {user_id}")

        await session.commit()

    print(f"[verify] officer {user_id} verified by {admin.email}")
    await ws.send_json({"type": "officer_verified", "user_id": str(user_id)})
    await _broadcast_officers_update()


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
            elif msg_type == "list_officers":
                await _handle_list_officers(ws, user)
            else:
                print(f"[ws/{user.email}] unknown message: {data}")
    except WebSocketDisconnect:
        manager.disconnect(ws)


@app.get("/")
def read_root():
    return {"service": "tfms", "status": "ok"}

