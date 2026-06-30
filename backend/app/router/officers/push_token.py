from fastapi import APIRouter, Depends, status
from sqlalchemy import delete, func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ...auth.authen import current_active_user
from ...database import get_async_session
from ...database.models import DeviceToken, User
from ...database.schemas import PushTokenDelete, PushTokenRegister

router = APIRouter()


@router.put("/me/push-token", status_code=status.HTTP_204_NO_CONTENT)
async def register_push_token(
    body: PushTokenRegister,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> None:
    stmt = (
        insert(DeviceToken)
        .values(user_id=user.id, token=body.token, platform=body.platform)
        .on_conflict_do_update(
            index_elements=["token"],
            set_={
                "user_id": user.id,
                "platform": body.platform,
                "last_seen": func.now(),
            },
        )
    )
    await session.execute(stmt)
    await session.commit()


@router.delete("/me/push-token", status_code=status.HTTP_204_NO_CONTENT)
async def delete_push_token(
    body: PushTokenDelete,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> None:
    await session.execute(
        delete(DeviceToken).where(
            DeviceToken.token == body.token, DeviceToken.user_id == user.id
        )
    )
    await session.commit()
