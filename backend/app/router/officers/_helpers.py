"""
Shared guard utilities for the officers sub-router.

Centralising the FieldOfficer lookup here ensures every endpoint applies the same
"officer record must exist" invariant without duplicating the query or error message.
"""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...database.models import FieldOfficer, User


async def get_field_officer(user: User, session: AsyncSession) -> FieldOfficer:
    """
    Resolve the FieldOfficer record for *user*, or raise 404.

    A User can exist without a FieldOfficer row (e.g. dispatchers, superusers).
    Endpoints that require an officer record call this instead of inline-querying
    to keep error handling consistent.

    Args:
        user:    The authenticated User whose FieldOfficer record is needed.
        session: Active async DB session.

    Returns:
        The FieldOfficer ORM object linked to this user.

    Raises:
        HTTPException(404): No FieldOfficer row exists for this user.
    """
    fo = (
        await session.execute(
            select(FieldOfficer).where(FieldOfficer.user_id == user.id)
        )
    ).scalar_one_or_none()
    if fo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field officer record not found")
    return fo
