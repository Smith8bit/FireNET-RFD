import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..auth.ws_auth import get_user_from_ws
from ..database import async_session_maker
from ..db_control.permission import is_admin_user, user_region_paths
from ..ws.manager import manager
from ..ws.dispatcher_handlers import (
    handle_create_dispatcher,
    handle_delete_dispatcher,
    handle_list_dispatchers,
    handle_update_dispatcher,
)
from ..ws.officer_handlers import (
    handle_appoint_officer,
    handle_delete_officer,
    handle_list_officers,
    handle_list_pending,
    handle_update_officer,
    handle_verify_officer,
    handle_list_officers_MAP
)

router = APIRouter()
logger = logging.getLogger("tfms.ws")


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    user = await get_user_from_ws(ws)
    if user is None:
        await ws.close(code=1008)
        return
    # the web app is admin/dispatcher only; field officers use the mobile app
    async with async_session_maker() as session:
        if not await is_admin_user(user, session):
            await ws.close(code=1008)
            return
        # resolve the visibility scope once, here, so recurring broadcasts can
        # bucket by it instead of re-deriving paths per connection on every tick
        paths = await user_region_paths(user, session)
    conn = await manager.connect(ws, user, paths)
    try:
        while True:
            try:
                data = await ws.receive_json()
            except ValueError:
                # malformed JSON: tell the client, keep the connection
                await ws.send_json({"type": "error", "code": "invalid_json"})
                continue
            match data.get("type"):
                case "list_pending_officers":
                    await handle_list_pending(ws, user)
                case "verify_officer":
                    await handle_verify_officer(ws, user, data, manager.active)
                case "update_officer":
                    await handle_update_officer(ws, user, data, manager.active)
                case "delete_officer":
                    await handle_delete_officer(ws, user, data, manager.active)
                case "appoint_officer":
                    await handle_appoint_officer(ws, user, data, manager.active)
                case "list_dispatchers":
                    await handle_list_dispatchers(ws, user)
                case "create_dispatcher":
                    await handle_create_dispatcher(ws, user, data)
                case "update_dispatcher":
                    await handle_update_dispatcher(ws, user, data)
                case "delete_dispatcher":
                    await handle_delete_dispatcher(ws, user, data)
                case "list_officers":
                    await handle_list_officers(ws, user)
                case "list_officers_MAP":
                    await handle_list_officers_MAP(ws, user)
                case "resync_fires":
                    # client detected a delta version gap: re-baseline its scope
                    await manager.send_snapshot(conn)
                case _:
                    logger.warning("ws user=%s unknown message type=%s", user.id, data.get("type"))
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("ws user=%s error: %s", user.id, exc)
    finally:
        manager.disconnect(ws)
