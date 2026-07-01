import uuid
from datetime import datetime

from geoalchemy2 import Geography
from geoalchemy2.elements import WKBElement
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Firespot(Base):
    __tablename__ = "firespots"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Deduplication key from the upstream satellite data feed.
    # Unique constraint prevents the same remote detection from creating two rows
    # on repeated ingestion runs.
    external_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    # JSONB stores variable satellite metadata without requiring schema 
    # migrations as the upstream data format evolves.
    detail: Mapped[dict] = mapped_column(JSONB, nullable=False)
    region_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        # RESTRICT prevents orphan firespots; a region must be explicitly reassigned
        # before it can be deleted.
        ForeignKey("regions.id", ondelete="RESTRICT"),
        nullable=False,
    )
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    location: Mapped[WKBElement] = mapped_column(
        Geography(geometry_type="POINT", srid=4326), nullable=False
    )
    # status=True means the fire has been resolved; False means active.
    status: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # expired: fire timed out without officer action (distinct from false_alarm).
    expired: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # false_alarm: officer confirmed the detection was incorrect.
    false_alarm: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    officer_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("field_officers.id"), nullable=True
    )
    resolve_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        # Enforces the invariant: an active fire has no resolve_time; a resolved
        # fire must have one. Prevents silent half-resolved state at the DB level.
        CheckConstraint(
            "(status = FALSE AND resolve_time IS NULL) OR "
            "(status = TRUE  AND resolve_time IS NOT NULL)",
            name="firespots_status_resolve_consistent",
        ),
        UniqueConstraint("external_id", name="uq_firespots_external_id"),
        Index("ix_firespots_region_id", "region_id"),
        Index("ix_firespots_detected_at", "detected_at"),
        # GiST index required for PostGIS spatial operators (ST_DWithin, ST_Within).
        Index("ix_firespots_location_gist", "location", postgresql_using="gist"),
    )
