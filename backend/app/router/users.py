from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.authen import current_active_user
from ..database import get_async_session
from ..database.models import User, UserRegion

router = APIRouter()


@router.get("/me/profile")
async def get_my_profile(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    name = (
        await session.execute(
            select(UserRegion.name).where(UserRegion.user_id == user.id).limit(1)
        )
    ).scalar_one_or_none()

    return {
        "id": str(user.id),
        "email": user.email,
        "is_active": user.is_active,
        "is_superuser": user.is_superuser,
        "is_verified": user.is_verified,
        "name": name,
    }
