import uuid
from typing import Optional

from fastapi import WebSocket
from fastapi_users.exceptions import UserNotExists
from sqlalchemy.ext.asyncio import AsyncSession

from .authen import get_jwt_strategy
from ..database.db import async_session_maker
from ..database.models import User
from ..db_control.users import UserManager
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase


async def get_user_from_ws(websocket: WebSocket) -> Optional[User]:
    """Verify the tfms_auth cookie on a WS handshake and return the User, or None."""
    token = websocket.cookies.get("tfms_auth")
    if not token:
        return None

    strategy = get_jwt_strategy()
    session: AsyncSession
    async with async_session_maker() as session:
        user_db = SQLAlchemyUserDatabase(session, User)
        user_manager = UserManager(user_db)
        try:
            user = await strategy.read_token(token, user_manager)
        except Exception:
            return None
        if user is None or not user.is_active:
            return None
        return user