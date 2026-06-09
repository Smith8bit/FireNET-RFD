from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..auth.ws_auth import get_user_from_ws
from ..ws.manager import manager
from ..ws.officer_handlers import (
    handle_list_officers,
    handle_list_pending,
    handle_verify_officer,
    handle_list_officers_MAP
)

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    user = await get_user_from_ws(ws)
    if user is None:
        await ws.close(code=1008)
        return
    await manager.connect(ws, user)
    try:
        while True:
            data = await ws.receive_json()
            match data.get("type"):
                case "list_pending_officers":
                    await handle_list_pending(ws, user)
                case "verify_officer":
                    await handle_verify_officer(ws, user, data, manager.active)
                case "list_officers":
                    await handle_list_officers(ws, user)
                case "list_officers_MAP":
                    await handle_list_officers_MAP(ws, user)
                case _:
                    print(f"[ws/{user.email}] unknown message: {data}")
    except WebSocketDisconnect:
        manager.disconnect(ws)
