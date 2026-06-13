import uuid
from typing import AsyncGenerator

from fastapi import Depends
from fastapi_users import BaseUserManager, UUIDIDMixin
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database import get_async_session
from ..database.models import User
from .audit import audit

settings = get_settings()


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = settings.JWT_SECRET
    verification_token_secret = settings.JWT_SECRET

    async def on_after_register(self, user: User, request=None):
        print(f"[users] registered: {user.email}")
        audit(self.user_db.session, actor=user, action="auth.register",
              entity_type="user", entity_id=str(user.id))
        await self.user_db.session.commit()

    async def on_after_login(self, user: User, request=None, response=None):
        print(f"[users] login: {user.email}")
        audit(self.user_db.session, actor=user, action="auth.login",
              entity_type="user", entity_id=str(user.id))
        await self.user_db.session.commit()


async def get_user_db(
    session: AsyncSession = Depends(get_async_session),
) -> AsyncGenerator[SQLAlchemyUserDatabase, None]:
    yield SQLAlchemyUserDatabase(session, User)


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)