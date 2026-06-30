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
            safe=True,
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
    exists = (
        await session.execute(
            select(User.id).where(func.lower(User.email) == username.strip().lower())
        )
    ).scalar_one_or_none()
    return {"available": exists is None}
