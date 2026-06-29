"""Login / refresh / logout for both clients.

Replaces fastapi-users' stock auth routers so login can issue a refresh token
alongside the access token in one atomic transaction. Two surfaces over the same
machinery:
  - /auth/cookie/*  web console — httpOnly access + refresh cookies
  - /auth/jwt/*     mobile — access + refresh tokens in the JSON body

The refresh cookie is path=/ (like the access cookie) so it reaches the auth
endpoints regardless of where the app is reverse-proxied. ponytail: scoping it to
/auth/cookie broke logout/refresh once the app moved under a /firenet/api prefix —
the browser stopped sending it. Re-scope only via a configured base-path env var,
never a hardcoded prefix.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from fastapi_users.exceptions import UserNotExists

from ..auth.authen import cookie_transport, get_jwt_strategy
from ..auth.refresh import issue_refresh_token, revoke_refresh_token, rotate_refresh_token
from ..config import get_settings
from ..database.schemas import RefreshRequest
from ..db_control.audit import audit
from ..db_control.users import UserManager, get_user_manager

settings = get_settings()
router = APIRouter()

REFRESH_COOKIE = "firenet_refresh"
REFRESH_COOKIE_PATH = "/"

# fastapi-users uses this exact code for a failed credential check; the web/mobile
# clients map it to a localized message, so keep it identical.
BAD_CREDENTIALS = "LOGIN_BAD_CREDENTIALS"


def _set_refresh_cookie(response: Response, raw: str) -> None:
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
    user = await manager.authenticate(credentials)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=BAD_CREDENTIALS)
    return user


async def _new_access_for(manager: UserManager, user_id) -> str | None:
    """Mint a fresh access token for a refresh, re-checking the account is still active."""
    try:
        user = await manager.get(user_id)
    except UserNotExists:
        return None  # account deleted out from under a live refresh token
    if not user.is_active:
        return None
    return await get_jwt_strategy().write_token(user)


# --- mobile (bearer) ---------------------------------------------------------

@router.post("/jwt/login", tags=["auth"])
async def jwt_login(
    credentials: OAuth2PasswordRequestForm = Depends(),
    manager: UserManager = Depends(get_user_manager),
):
    user = await _authenticate(manager, credentials)
    session = manager.user_db.session
    access = await get_jwt_strategy().write_token(user)
    refresh = await issue_refresh_token(session, user.id)
    audit(session, actor=user, action="auth.login", entity_type="user", entity_id=str(user.id))
    await session.commit()
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer"}


@router.post("/jwt/refresh", tags=["auth"])
async def jwt_refresh(
    payload: RefreshRequest,
    manager: UserManager = Depends(get_user_manager),
):
    session = manager.user_db.session
    rotated = await rotate_refresh_token(session, payload.refresh_token)
    access = None
    if rotated is not None:
        access = await _new_access_for(manager, rotated[0])
    await session.commit()  # persist rotation / reuse-revocation either way
    if rotated is None or access is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="INVALID_REFRESH_TOKEN")
    return {"access_token": access, "refresh_token": rotated[1], "token_type": "bearer"}


@router.post("/jwt/logout", status_code=status.HTTP_204_NO_CONTENT, tags=["auth"])
async def jwt_logout(
    payload: RefreshRequest,
    manager: UserManager = Depends(get_user_manager),
):
    session = manager.user_db.session
    await revoke_refresh_token(session, payload.refresh_token)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- web (cookie) ------------------------------------------------------------

@router.post("/cookie/login", tags=["auth"])
async def cookie_login(
    credentials: OAuth2PasswordRequestForm = Depends(),
    manager: UserManager = Depends(get_user_manager),
):
    user = await _authenticate(manager, credentials)
    session = manager.user_db.session
    access = await get_jwt_strategy().write_token(user)
    refresh = await issue_refresh_token(session, user.id)
    audit(session, actor=user, action="auth.login", entity_type="user", entity_id=str(user.id))
    await session.commit()
    response = await cookie_transport.get_login_response(access)
    _set_refresh_cookie(response, refresh)
    return response


@router.post("/cookie/refresh", tags=["auth"])
async def cookie_refresh(
    request: Request,
    manager: UserManager = Depends(get_user_manager),
):
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="INVALID_REFRESH_TOKEN")
    session = manager.user_db.session
    rotated = await rotate_refresh_token(session, raw)
    access = None
    if rotated is not None:
        access = await _new_access_for(manager, rotated[0])
    await session.commit()
    if rotated is None or access is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="INVALID_REFRESH_TOKEN")
    response = await cookie_transport.get_login_response(access)
    _set_refresh_cookie(response, rotated[1])
    return response


@router.post("/cookie/logout", tags=["auth"])
async def cookie_logout(
    request: Request,
    manager: UserManager = Depends(get_user_manager),
):
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        session = manager.user_db.session
        await revoke_refresh_token(session, raw)
        await session.commit()
    response = await cookie_transport.get_logout_response()
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_COOKIE_PATH)
    return response
