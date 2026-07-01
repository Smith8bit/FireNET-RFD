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

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("user.id", ondelete="SET NULL"), nullable=False
    )
    # SET NULL (not CASCADE): officer record is preserved when a fire is deleted,
    # maintaining duty history and allowing re-assignment to a new fire.
    fire_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("firespots.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    appointed: Mapped[bool] = mapped_column(default=False, server_default="false")
    active: Mapped[bool] = mapped_column(default=False)
    # Geography (spherical) not Geometry (planar) — gives accurate metre-based
    # distance calculations across lat/lon without projection errors.
    # SRID 4326 = WGS84, the coordinate system used by GPS and mobile devices.
    last_location: Mapped[WKBElement | None] = mapped_column(
        Geography(geometry_type="POINT", srid=4326), nullable=True
    )
    last_updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    note: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        Index("ix_field_officer_user_id", "user_id"),
        # unique=True enforces one active fire assignment per officer at the DB level.
        Index("ix_field_officer_fire_id", "fire_id", unique=True),
        # Supports efficient queries for recently active officers (e.g., location heartbeat).
        Index("ix_field_officer_last_updated", "last_updated"),
    )
