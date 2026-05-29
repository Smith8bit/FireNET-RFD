import uuid

from fastapi_users import FastAPIUsers
from fastapi_users.authentication import AuthenticationBackend, CookieTransport, JWTStrategy

from ..config import get_settings
from ..database.models import User
from ..db_control.users import get_user_manager

settings = get_settings()

cookie_transport = CookieTransport(
    cookie_name="tfms_auth",
    cookie_max_age=settings.COOKIE_MAX_AGE,
    cookie_secure=settings.COOKIE_SECURE,
    cookie_httponly=True,
    cookie_samesite="lax",
)


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(secret=settings.JWT_SECRET, lifetime_seconds=settings.COOKIE_MAX_AGE)


auth_backend = AuthenticationBackend(
    name="cookie",
    transport=cookie_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)
current_superuser = fastapi_users.current_user(active=True, superuser=True)