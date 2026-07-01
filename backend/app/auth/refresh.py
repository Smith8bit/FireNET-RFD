import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database.models import RefreshToken

# Refresh tokens complement the short-lived JWT (ACCESS_TOKEN_MAX_AGE).
# They are long-lived (REFRESH_TOKEN_MAX_AGE), server-side revocable, and
# implement rotation with theft detection — the raw token is never persisted.

settings = get_settings()

# 32 bytes → 43-char base64url string → ~256 bits of entropy; collision-proof for DB unique constraint.
_TOKEN_URL_SAFE_BYTES = 32


def _hash(raw: str) -> str:
    # Store only SHA-256 of the token, never the plaintext.
    # SHA-256 (not bcrypt) is acceptable here because high-entropy random tokens
    # don't benefit from key-stretching; lookup speed matters more.
    return hashlib.sha256(raw.encode()).hexdigest()


async def issue_refresh_token(session: AsyncSession, user_id: uuid.UUID) -> str:
    """Create and persist a new refresh token for `user_id`.

    Args:
        session:  Active async DB session. Caller owns the transaction boundary
                  (no flush/commit here — allows atomic pairing with JWT issuance).
        user_id:  UUID of the authenticated user.

    Returns:
        raw:  The plaintext token string to hand to the client.
              Only the SHA-256 hash is written to the DB.
    """
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
    """Validate, revoke, and replace a refresh token (rotation pattern).

    Implements theft detection: if a previously-revoked token is replayed,
    every active token for that user is invalidated to contain the breach.

    Args:
        session:  Active async DB session.
        raw:      Plaintext refresh token received from the client.

    Returns:
        (user_id, new_raw_token) on success, or None when the token is
        unknown, already revoked, or expired.
    """
    row = (
        await session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == _hash(raw))
        )
    ).scalar_one_or_none()

    if row is None:                    # unknown token — treat as invalid
        return None

    now = datetime.now(timezone.utc)

    if row.revoked_at is not None:
        # Token was already consumed: this is a replay attack.
        # Revoke every live token for this user and force re-login.
        await revoke_all_for_user(session, row.user_id)
        return None

    if row.expires_at <= now:          # token has passed its TTL
        return None

    row.revoked_at = now               # soft-delete the consumed token
    new_raw = await issue_refresh_token(session, row.user_id)
    return row.user_id, new_raw


async def revoke_refresh_token(session: AsyncSession, raw: str) -> None:
    """Soft-delete a single refresh token (normal logout).

    Args:
        session:  Active async DB session.
        raw:      Plaintext refresh token to revoke.

    Only affects tokens that have not already been revoked (idempotent).
    """
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.token_hash == _hash(raw), RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )


async def revoke_all_for_user(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Soft-delete every active refresh token for `user_id`.

    Used for "logout everywhere" and as the theft-detection response in
    `rotate_refresh_token`. Issues a single bulk UPDATE rather than loading
    individual rows to keep the operation O(1) in query cost.

    Args:
        session:  Active async DB session.
        user_id:  UUID of the user whose tokens are being invalidated.
    """
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )
