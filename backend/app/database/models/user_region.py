import uuid

from sqlalchemy import ForeignKey, String, Text
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
    # role is required; every assignment must state it explicitly. Valid values:
    # "admin" / "dispatcher" (web console + officer management, scoped by region)
    # and "field_officer" (mobile). There is no read-only role.
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)