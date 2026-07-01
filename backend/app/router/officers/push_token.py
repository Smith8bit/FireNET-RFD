"""
Device push-token registration and removal for field officer notifications.

A single physical device (token) can only belong to one user at a time. The upsert
on `token` reassigns ownership when a device logs in under a different account,
preventing stale tokens from delivering notifications to the wrong user after
account switching on shared devices.
"""

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
    """
    Register or refresh a device push token for the calling officer.

    Uses a PostgreSQL upsert (ON CONFLICT DO UPDATE) so that:
    - First registration: inserts a new DeviceToken row.
    - Re-registration (same token, same user): updates `last_seen` only.
    - Account switch (same token, different user): reassigns ownership to the new user.

    Args:
        body:    PushTokenRegister with `token` (str) and `platform` ("ios" | "android").
        user:    Authenticated field officer who owns this device.
        session: Async DB session.

    Returns:
        204 No Content.
    """
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
    """
    Remove a specific device token owned by the calling officer.

    The `user_id` filter prevents an officer from deleting another user's token
    by sending an arbitrary token value. No-op if the token does not exist or
    already belongs to a different user.

    Args:
        body:    PushTokenDelete with `token` (str) to remove.
        user:    Authenticated officer; only tokens owned by this user are deleted.
        session: Async DB session.

    Returns:
        204 No Content.
    """
    await session.execute(
        delete(DeviceToken).where(
            DeviceToken.token == body.token, DeviceToken.user_id == user.id
        )
    )
    await session.commit()
