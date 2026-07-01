from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db import Base


# Simple key-value config store for runtime-adjustable settings
# (e.g., "location_poll_interval"). No timestamps — these are long-lived
# operational parameters, not audited state.
class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
