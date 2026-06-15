import uuid

from fastapi_users import FastAPIUsers
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    CookieTransport,
    JWTStrategy,
)

from ..config import get_settings
from ..database.models import User
from ..db_control.users import get_user_manager

settings = get_settings()

# Web console: httpOnly cookie (browser-managed, CSRF-resistant via SameSite).
cookie_transport = CookieTransport(
    cookie_name="tfms_auth",
    cookie_max_age=settings.COOKIE_MAX_AGE,
    cookie_secure=settings.COOKIE_SECURE,
    cookie_httponly=True,
    cookie_samesite="lax",
)

# Mobile (native): Authorization: Bearer token, stored in the device keystore.
# Avoids React Native's fragile cookie persistence. tokenUrl is OpenAPI metadata only.
bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(secret=settings.JWT_SECRET, lifetime_seconds=settings.COOKIE_MAX_AGE)


auth_backend = AuthenticationBackend(
    name="cookie",
    transport=cookie_transport,
    get_strategy=get_jwt_strategy,
)

bearer_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

# Both backends are registered, so every protected endpoint accepts EITHER a valid
# cookie (web) OR a valid bearer token (mobile) — no per-route changes needed.
fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend, bearer_backend])

current_active_user = fastapi_users.current_user(active=True)
current_superuser = fastapi_users.current_user(active=True, superuser=True)