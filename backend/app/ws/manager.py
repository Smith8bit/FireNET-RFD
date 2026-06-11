from typing import Tuple

from fastapi import WebSocket

from ..database import async_session_maker
from ..database.models import User
from ..db_control.fires import get_fires
from ..db_control.permission import fire_visible


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

    async def broadcast_fires(self) -> None:
        """Push a fresh, per-user-visible fire list to every client."""
        for ws, user in list(self.active):
            try:
                fires = await get_fires(user=user)
                await ws.send_json({"fires": fires})
            except Exception as exc:
                print(f"[ws] failed to push fires to {user.email}: {exc}")


manager = ConnectionManager()
