import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class UserRegion(Base):
    __tablename__ = "user_regions"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("user.id", ondelete="CASCADE"), primary_key=True
    )
    region_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("regions.id", ondelete="CASCADE"), primary_key=True
    )
    # role is the coarse identity: "admin" / "dispatcher" (web console) or
    # "field_officer" (mobile). Fine-grained console authority now lives in
    # `permissions`; role doubles as the preset for assignments not yet backfilled
    # with an explicit set (see db_control.permission.effective_perms).
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    # granted console permissions for this region (see db_control.permission).
    # Empty = fall back to the role preset.
    permissions: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=text("'{}'"), default=list
    )
    # when this region assignment was created; used to sort dispatchers/officers
    # by "recently added". DB-set so it's authoritative regardless of caller.
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )