import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ..db import Base


class RefreshToken(Base):
    """A rotating, revocable refresh token for one login session.

    Only a SHA-256 hash of the raw token is stored — a database leak can't be
    replayed as a credential. Rotated on every use: the old row is marked revoked
    and a new one issued. Presenting an already-revoked token (reuse) is the
    classic stolen-token signal and revokes the user's whole family. See
    auth/refresh.py."""

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_refresh_tokens_user_id", "user_id"),
    )
