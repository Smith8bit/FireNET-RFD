from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import current_active_user
from ..database import get_async_session
from ..database.models import User
from ..db_control.fires import get_fire_db

router = APIRouter()


@router.get("")
async def list_fires(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    return await get_fire_db(user, session)
