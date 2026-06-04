import uuid
from datetime import datetime

from geoalchemy2 import Geography
from geoalchemy2.elements import WKBElement
from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class Firespot(Base):
    __tablename__ = "firespots"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    region_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("regions.id", ondelete="RESTRICT"), nullable=False)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    location: Mapped[WKBElement] = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    status: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    resolve_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(
            "(status = FALSE AND resolve_time IS NULL) OR "
            "(status = TRUE  AND resolve_time IS NOT NULL)",
            name="firespots_status_resolve_consistent",
        ),
        Index("ix_firespots_region_id", "region_id"),
        Index("ix_firespots_detected_at", "detected_at"),
        Index("ix_firespots_location_gist", "location", postgresql_using="gist"),
    )