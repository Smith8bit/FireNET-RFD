from typing import Optional

from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from .authen import get_jwt_strategy
from ..database.db import async_session_maker
from ..database.models import User
from ..db_control.users import UserManager
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase


# WebSocket upgrade requests are HTTP GETs: browsers cannot attach
# Authorization headers via the JS WebSocket API.  Cookies are sent
# automatically, so we read the same HttpOnly cookie that the HTTP
# endpoints set rather than inventing a separate WS credential flow.


async def get_user_from_ws(websocket: WebSocket) -> Optional[User]:
    """Authenticate a WebSocket connection from its session cookie.

    Manually replicates the fastapi-users cookie-backend pipeline because
    WebSocket routes cannot use FastAPI dependency injection with Depends()
    the same way HTTP routes can.

    Args:
        websocket:  The incoming WebSocket connection object.
                    The `firenet_auth` cookie must be present and valid.

    Returns:
        The authenticated, active User instance, or None if the cookie is
        absent, the JWT is expired/malformed/wrong-secret, or the account
        is inactive.  Callers should close the socket on None.

    Assumptions:
        - Cookie name matches the one set in authen.py CookieTransport.
        - A fresh DB session is opened and closed per auth check; it is NOT
          reused for the lifetime of the WebSocket connection.
    """
    token = websocket.cookies.get("firenet_auth")
    if not token:
        return None

    strategy = get_jwt_strategy()

    session: AsyncSession
    async with async_session_maker() as session:
        user_db = SQLAlchemyUserDatabase(session, User)
        user_manager = UserManager(user_db)
        try:
            # read_token decodes + verifies the JWT and fetches the User row.
            user = await strategy.read_token(token, user_manager)
        except Exception:
            # Swallow all JWT errors (expired, bad signature, malformed)
            # and surface them uniformly as None — no auth detail leakage.
            return None

        if user is None or not user.is_active:
            return None

        return user
