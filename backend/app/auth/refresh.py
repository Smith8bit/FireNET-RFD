import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database.models import RefreshToken

settings = get_settings()

_TOKEN_URL_SAFE_BYTES = 32


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def issue_refresh_token(session: AsyncSession, user_id: uuid.UUID) -> str:
    raw = secrets.token_urlsafe(_TOKEN_URL_SAFE_BYTES)
    session.add(
        RefreshToken(
            user_id=user_id,
            token_hash=_hash(raw),
            expires_at=datetime.now(timezone.utc)
            + timedelta(seconds=settings.REFRESH_TOKEN_MAX_AGE),
        )
    )
    return raw


async def rotate_refresh_token(
    session: AsyncSession, raw: str
) -> tuple[uuid.UUID, str] | None:
    row = (
        await session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == _hash(raw))
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    now = datetime.now(timezone.utc)
    if row.revoked_at is not None:
        await revoke_all_for_user(session, row.user_id)
        return None
    if row.expires_at <= now:
        return None
    row.revoked_at = now
    new_raw = await issue_refresh_token(session, row.user_id)
    return row.user_id, new_raw


async def revoke_refresh_token(session: AsyncSession, raw: str) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == _hash(raw), RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )


async def revoke_all_for_user(session: AsyncSession, user_id: uuid.UUID) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )
