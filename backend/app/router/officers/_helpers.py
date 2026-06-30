from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database.models import FieldOfficer, User


async def get_field_officer(user: User, session: AsyncSession) -> FieldOfficer:
    fo = (
        await session.execute(
            select(FieldOfficer).where(FieldOfficer.user_id == user.id)
        )
    ).scalar_one_or_none()
    if fo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field officer record not found")
    return fo
