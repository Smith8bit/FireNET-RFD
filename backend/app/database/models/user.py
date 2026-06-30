from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from ..db import Base


class User(SQLAlchemyBaseUserTableUUID, Base):
    division: Mapped[str | None] = mapped_column(Text, nullable=True)
