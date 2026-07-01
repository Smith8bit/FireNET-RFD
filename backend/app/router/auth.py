"""
Dual-transport authentication router (JWT bearer + HttpOnly cookie).

Both transports share identical token-pair logic; only the delivery mechanism differs.
The refresh token is stored in the DB and rotated on every use (one-time-use tokens),
so a stolen token cannot be silently reused — the next legitimate rotation will invalidate it.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users.exceptions import UserNotExists

from ..auth.authen import cookie_transport, get_jwt_strategy
from ..auth.refresh import (
    issue_refresh_token,
    revoke_refresh_token,
    rotate_refresh_token,
)
from ..config import get_settings
from ..database.schemas import RefreshRequest
from ..db_control.audit import audit
from ..db_control.users import UserManager, get_user_manager

settings = get_settings()
router = APIRouter()

# Cookie name and path are constants so logout can reliably target the same cookie.
REFRESH_COOKIE = "firenet_refresh"
REFRESH_COOKIE_PATH = "/"

# Single error string for both "wrong password" and "user not found" prevents username enumeration.
BAD_CREDENTIALS = "LOGIN_BAD_CREDENTIALS"


async def _issue_tokens(session, user) -> tuple[str, str]:
    """
    Mint an access JWT and a persisted refresh token for *user*, then write an audit entry.

    The audit call and both token writes happen inside a single commit so that a
    partial failure never produces a token without an audit record.

    Returns:
        (access_token_str, refresh_token_str)
    """
    access = await get_jwt_strategy().write_token(user)
    refresh = await issue_refresh_token(session, user.id)
    audit(
        session,
        actor=user,
        action="auth.login",
        entity_type="user",
        entity_id=str(user.id),
    )
    await session.commit()
    return access, refresh


def _set_refresh_cookie(response: Response, raw: str) -> None:
    """
    Attach the refresh token as an HttpOnly cookie to *response*.

    HttpOnly blocks JS access; SameSite=lax blocks CSRF on cross-site navigations
    while still allowing top-level redirects. `secure` is environment-controlled
    so local dev can run over HTTP.

    Args:
        response: The FastAPI Response object being built.
        raw:      The raw refresh-token string to embed.
    """
    response.set_cookie(
        REFRESH_COOKIE,
        raw,
        max_age=settings.REFRESH_TOKEN_MAX_AGE,
        path=REFRESH_COOKIE_PATH,
        secure=settings.COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )


async def _authenticate(manager: UserManager, credentials: OAuth2PasswordRequestForm):
    """
    Validate credentials and return the active User, or raise HTTP 400.

    Merging "wrong password" and "inactive account" into the same error code
    avoids leaking whether the email exists in the system.

    Args:
        manager:     fastapi-users UserManager with DB session attached.
        credentials: Standard OAuth2 form (username/password).

    Returns:
        User — verified, active account.

    Raises:
        HTTPException(400): Credentials invalid or account inactive.
    """
    user = await manager.authenticate(credentials)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=BAD_CREDENTIALS)
    return user


async def _new_access_for(manager: UserManager, user_id) -> str | None:
    """
    Issue a fresh access JWT for *user_id*, or return None if the account is gone/inactive.

    Returns None rather than raising so the refresh endpoint can surface a single
    INVALID_REFRESH_TOKEN error regardless of whether the problem is the token or the user.

    Args:
        manager: UserManager providing the DB-backed user lookup.
        user_id: UUID of the user to mint a token for.

    Returns:
        JWT string, or None if the user no longer exists or is deactivated.
    """
    try:
        user = await manager.get(user_id)
    except UserNotExists:
        return None
    if not user.is_active:
        return None
    return await get_jwt_strategy().write_token(user)


# ── JWT bearer transport ──────────────────────────────────────────────────────

@router.post("/jwt/login", tags=["auth"])
async def jwt_login(
    credentials: OAuth2PasswordRequestForm = Depends(),
    manager: UserManager = Depends(get_user_manager),
):
    """
    Authenticate and return both tokens in the JSON body.

    Args:
        credentials: OAuth2 form fields — `username` (email) and `password`.
        manager:     Injected UserManager.

    Returns:
        {"access_token": str, "refresh_token": str, "token_type": "bearer"}
    """
    user = await _authenticate(manager, credentials)
    session = manager.user_db.session
    access, refresh = await _issue_tokens(session, user)
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer"}


@router.post("/jwt/refresh", tags=["auth"])
async def jwt_refresh(
    payload: RefreshRequest,
    manager: UserManager = Depends(get_user_manager),
):
    """
    Rotate a refresh token: consume the old one and issue a new pair.

    Both the DB rotate and the access-mint must succeed; if either fails the
    endpoint returns 401 so the client re-authenticates from scratch.

    Args:
        payload: Body containing `refresh_token` (the current single-use token).
        manager: Injected UserManager.

    Returns:
        {"access_token": str, "refresh_token": str, "token_type": "bearer"}

    Raises:
        HTTPException(401): Token expired, revoked, unknown, or user deactivated.
    """
    session = manager.user_db.session
    rotated = await rotate_refresh_token(session, payload.refresh_token)
    access = None
    if rotated is not None:
        access = await _new_access_for(manager, rotated[0])
    await session.commit()
    if rotated is None or access is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, detail="INVALID_REFRESH_TOKEN"
        )
    return {"access_token": access, "refresh_token": rotated[1], "token_type": "bearer"}


@router.post("/jwt/logout", status_code=status.HTTP_204_NO_CONTENT, tags=["auth"])
async def jwt_logout(
    payload: RefreshRequest,
    manager: UserManager = Depends(get_user_manager),
):
    """
    Revoke the supplied refresh token, invalidating that session server-side.

    Args:
        payload: Body containing `refresh_token` to revoke.
        manager: Injected UserManager.

    Returns:
        204 No Content.
    """
    session = manager.user_db.session
    await revoke_refresh_token(session, payload.refresh_token)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Cookie transport ──────────────────────────────────────────────────────────

@router.post("/cookie/login", tags=["auth"])
async def cookie_login(
    credentials: OAuth2PasswordRequestForm = Depends(),
    manager: UserManager = Depends(get_user_manager),
):
    """
    Authenticate and deliver the access token via the cookie_transport response
    while setting the refresh token as a separate HttpOnly cookie.

    Args:
        credentials: OAuth2 form fields — `username` (email) and `password`.
        manager:     Injected UserManager.

    Returns:
        Response with `Set-Cookie` headers for both the access and refresh tokens.
    """
    user = await _authenticate(manager, credentials)
    session = manager.user_db.session
    access, refresh = await _issue_tokens(session, user)
    response = await cookie_transport.get_login_response(access)
    _set_refresh_cookie(response, refresh)
    return response


@router.post("/cookie/refresh", tags=["auth"])
async def cookie_refresh(
    request: Request,
    manager: UserManager = Depends(get_user_manager),
):
    """
    Silently rotate the cookie-based session: read the refresh cookie, issue a new pair,
    and re-write both cookies.

    Args:
        request: Raw request needed to read incoming cookies.
        manager: Injected UserManager.

    Returns:
        Response with updated `Set-Cookie` headers.

    Raises:
        HTTPException(401): Refresh cookie absent, token invalid, or user deactivated.
    """
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, detail="INVALID_REFRESH_TOKEN"
        )
    session = manager.user_db.session
    rotated = await rotate_refresh_token(session, raw)
    access = None
    if rotated is not None:
        access = await _new_access_for(manager, rotated[0])
    await session.commit()
    if rotated is None or access is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, detail="INVALID_REFRESH_TOKEN"
        )
    response = await cookie_transport.get_login_response(access)
    _set_refresh_cookie(response, rotated[1])
    return response


@router.post("/cookie/logout", tags=["auth"])
async def cookie_logout(
    request: Request,
    manager: UserManager = Depends(get_user_manager),
):
    """
    Revoke the refresh cookie session and clear both cookies.

    Intentionally does NOT fail if the refresh cookie is already absent —
    the client should be able to call logout regardless of session state.

    Args:
        request: Raw request needed to read the refresh cookie.
        manager: Injected UserManager.

    Returns:
        Response that clears the access and refresh cookies.
    """
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        session = manager.user_db.session
        await revoke_refresh_token(session, raw)
        await session.commit()
    response = await cookie_transport.get_logout_response()
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)
    return response
