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

# --- Dual-transport auth architecture ---
# Browser clients send the JWT inside an HttpOnly cookie (XSS-safe, no JS access).
# API / mobile clients send it as a Bearer token in the Authorization header.
# Both transports validate against the same JWTStrategy so tokens are interchangeable.

# HttpOnly + SameSite=lax: mitigates XSS (JS can't read cookie) and CSRF
# (lax blocks cross-site POST while allowing top-level navigations).
cookie_transport = CookieTransport(
    cookie_name="firenet_auth",
    cookie_max_age=settings.ACCESS_TOKEN_MAX_AGE,   # seconds; synced to JWT lifetime
    cookie_secure=settings.COOKIE_SECURE,            # env-controlled; False in dev, True in prod
    cookie_httponly=True,
    cookie_samesite="lax",
)

# Advertises the login URL in WWW-Authenticate challenge headers for API clients.
bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")


def get_jwt_strategy() -> JWTStrategy:
    # Factory (not singleton) so FastAPIUsers can call it per-request.
    # Both backends share this factory → same secret and same TTL for every token.
    return JWTStrategy(
        secret=settings.JWT_SECRET, lifetime_seconds=settings.ACCESS_TOKEN_MAX_AGE
    )


# "cookie" backend: issues/reads tokens via the HttpOnly cookie.
auth_backend = AuthenticationBackend(
    name="cookie",
    transport=cookie_transport,
    get_strategy=get_jwt_strategy,
)

# "jwt" backend: issues/reads tokens via the Authorization: Bearer header.
bearer_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

# Central FastAPIUsers hub — generic params bind the ORM User model and its UUID PK type.
# Registering both backends allows login/logout endpoints for each transport.
fastapi_users = FastAPIUsers[User, uuid.UUID](
    get_user_manager, [auth_backend, bearer_backend]
)

# FastAPI dependency: resolves the authenticated User from the request.
# Raises HTTP 401 if the token is missing, expired, or belongs to an inactive account.
current_active_user = fastapi_users.current_user(active=True)

# Same as above but additionally enforces is_superuser=True; raises HTTP 403 otherwise.
current_superuser = fastapi_users.current_user(active=True, superuser=True)
