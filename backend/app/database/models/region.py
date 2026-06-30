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
    level: Mapped[str] = mapped_column(String(32), nullable=False)
    path: Mapped[str] = mapped_column(Ltree, nullable=False, unique=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("regions.id", ondelete="CASCADE"),
        nullable=True,
    )

    parent: Mapped["Region | None"] = relationship(
        "Region", remote_side="Region.id", lazy="joined"
    )

    __table_args__ = (Index("ix_regions_path_gist", "path", postgresql_using="gist"),)
