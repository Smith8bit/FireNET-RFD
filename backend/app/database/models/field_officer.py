import uuid
from datetime import datetime

from geoalchemy2 import Geography
from geoalchemy2.elements import WKBElement
from sqlalchemy import DateTime, ForeignKey, Index, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from ..db import Base


class FieldOfficer(Base):
    __tablename__ = "field_officers"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=False)
    fire_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("firespots.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(default=False)
    last_location: Mapped[WKBElement | None] = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=True)
    last_updated: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    note: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("ix_field_officer_user_id", "user_id"),
        # unique: first-come-first-served — a fire is held by at most one officer
        Index("ix_field_officer_fire_id", "fire_id", unique=True),
        Index("ix_field_officer_last_updated", "last_updated"),
    )