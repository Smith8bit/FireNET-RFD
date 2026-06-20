from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


class AppSetting(Base):
    """Tiny key/value store for runtime-mutable global settings a superuser sets
    from the console (currently just the officer location-poll interval).
    ponytail: one KV table beats one bespoke table per knob; add columns/typing
    only if a setting ever needs more than a string."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
