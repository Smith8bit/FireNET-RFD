import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ..db import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # SET NULL (not CASCADE): log entries must persist even after the acting user
    # is deleted — audit trails are immutable by design.
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    # Snapshot of the actor's username/email at the time of the action; survives
    # account deletion or email changes so the log remains interpretable.
    actor_email: Mapped[str] = mapped_column(Text, nullable=False)
    # Short verb slug, e.g. "officer.assign" or "fire.resolve" (max 64 chars).
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    __table_args__ = (
        Index("ix_audit_log_at", "at"),
        # Composite indexes ordered by time support range queries:
        # - per-actor history (actor_id, at)
        # - per-entity history (entity_type, entity_id, at)
        Index("ix_audit_log_actor_at", "actor_id", "at"),
        Index("ix_audit_log_entity_at", "entity_type", "entity_id", "at"),
        Index("ix_audit_log_action", "action"),
    )
