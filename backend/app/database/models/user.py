from sqlalchemy import Text
from sqlalchemy.orm import Mapped, mapped_column

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from ..db import Base


# SQLAlchemyBaseUserTableUUID contributes: id (UUID PK), email, hashed_password,
# is_active, is_superuser, is_verified.  Only domain-specific columns are added here.
class User(SQLAlchemyBaseUserTableUUID, Base):
    # Optional organisational unit (e.g., department name). Stored as free-text
    # rather than a FK so the schema stays decoupled from org-chart changes.
    division: Mapped[str | None] = mapped_column(Text, nullable=True)
