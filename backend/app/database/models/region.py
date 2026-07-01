import uuid

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..db import Base
from ..ltree import Ltree


class Region(Base):
    __tablename__ = "regions"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name_th: Mapped[str] = mapped_column(String(255), nullable=False)
    name_en: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Discriminator for the 3-level hierarchy: "national" | "regional" | "province".
    level: Mapped[str] = mapped_column(String(32), nullable=False)
    # Dot-separated LTREE path (e.g., "th.r1.chiangmai") enables ancestor/descendant
    # queries with @> / <@ operators, avoiding recursive CTEs for hierarchy traversal.
    path: Mapped[str] = mapped_column(Ltree, nullable=False, unique=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        # CASCADE: deleting a parent removes the entire sub-tree automatically.
        ForeignKey("regions.id", ondelete="CASCADE"),
        nullable=True,
    )

    # remote_side tells SQLAlchemy this is a self-referential relationship where
    # the FK (parent_id) is on the child; lazy="joined" avoids a second round-trip
    # for the shallow 3-level hierarchy.
    parent: Mapped["Region | None"] = relationship(
        "Region", remote_side="Region.id", lazy="joined"
    )

    # GiST index is required for LTREE operators; a standard B-tree index does not
    # support @> / <@ and would result in full-table scans on hierarchy queries.
    __table_args__ = (Index("ix_regions_path_gist", "path", postgresql_using="gist"),)
