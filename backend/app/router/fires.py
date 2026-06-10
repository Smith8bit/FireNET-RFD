from fastapi import APIRouter, Depends

from ..auth.authen import current_active_user
from ..database.models import User
from ..db_control.fires import get_fires

router = APIRouter()


@router.get("")
async def list_fires(user: User = Depends(current_active_user)):
    return await get_fires(user=user)
