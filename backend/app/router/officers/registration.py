"""
Self-registration endpoint for field officers.

This endpoint is intentionally unauthenticated — officers register themselves
and are activated by an admin. Province is validated before user creation so
that a failed province lookup doesn't leave a dangling User record.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi_users.exceptions import InvalidPasswordException, UserAlreadyExists
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ...auth.authen import current_active_user
from ...database import get_async_session
from ...database.models import Region, User, UserRegion
from ...database.schemas import OfficerRegister, UserCreate, UserRead, UserRole
from ...db_control.users import UserManager, get_user_manager

router = APIRouter()


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register_officer(
    body: OfficerRegister,
    manager: UserManager = Depends(get_user_manager),
    session: AsyncSession = Depends(get_async_session),
) -> UserRead:
    """
    Create a new field officer account linked to a province-level region.

    No authentication required — this is the public self-registration flow.
    `manager.create(..., safe=True)` strips any superuser/verified flags that
    might be injected in the request body, ensuring new accounts start unprivileged.

    Args:
        body:    OfficerRegister with `username` (email), `password`, `name`, `division`,
                 and `province_code`.
        manager: Injected UserManager for account creation.
        session: Async DB session for region lookup and UserRegion creation.

    Returns:
        UserRead — the created user (without sensitive fields).

    Raises:
        HTTPException(400): Province code invalid, email already taken, or password too weak.
    """
    province = (
        await session.execute(
            select(Region).where(
                Region.code == body.province_code, Region.level == "province"
            )
        )
    ).scalar_one_or_none()
    if province is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid province")
    try:
        user = await manager.create(
            UserCreate(
                email=body.username, password=body.password, division=body.division
            ),
            safe=True,  # Prevents privilege escalation via crafted request bodies.
        )
    except UserAlreadyExists:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "REGISTER_USER_ALREADY_EXISTS")
    except InvalidPasswordException as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"INVALID_PASSWORD: {e.reason}"
        )
    session.add(
        UserRegion(
            user_id=user.id,
            region_id=province.id,
            role=UserRole.FIELD_OFFICER,
            name=body.name,
        )
    )
    await session.commit()
    return user


@router.get("/username-available")
async def username_available(
    username: str,
    session: AsyncSession = Depends(get_async_session),
) -> dict[str, bool]:
    """
    Check whether an email address is available for registration.

    Case-insensitive comparison prevents registering "User@Example.com" when
    "user@example.com" already exists. No authentication required — used by
    the registration form before submission.

    Args:
        username: Email address to check (query param).
        session:  Async DB session.

    Returns:
        {"available": bool}
    """
    exists = (
        await session.execute(
            select(User.id).where(func.lower(User.email) == username.strip().lower())
        )
    ).scalar_one_or_none()
    return {"available": exists is None}
