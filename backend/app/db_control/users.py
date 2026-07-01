import logging
import uuid
from typing import AsyncGenerator

from fastapi import Depends
from fastapi_users import BaseUserManager, UUIDIDMixin
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import derive_secret
from ..database import get_async_session
from ..database.models import User
from .audit import audit

logger = logging.getLogger("firenet.users")


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    """fastapi-users manager with audit hooks for authentication lifecycle events.

    Token secrets are derived from a single application secret using domain-scoped
    key derivation (``derive_secret("reset")`` vs ``derive_secret("verify")``) so
    that a password-reset token cannot be replayed as an email-verification token
    and vice versa.
    """

    reset_password_token_secret = derive_secret("reset")
    verification_token_secret = derive_secret("verify")

    async def on_after_register(self, user: User, request=None):
        """Write an audit record immediately after a new user is persisted.

        ``self.user_db.session`` is the same session used by fastapi-users to create
        the user row, so the audit entry and the user creation commit atomically.
        """
        logger.info("user registered id=%s", user.id)
        audit(
            self.user_db.session,
            actor=user,
            action="auth.register",
            entity_type="user",
            entity_id=str(user.id),
        )
        await self.user_db.session.commit()

    async def on_after_login(self, user: User, request=None, response=None):
        """Write an audit record on every successful login.

        Useful for detecting suspicious access patterns (e.g. logins from unexpected
        regions or unusual hours) without enabling full request logging.
        """
        logger.info("user login id=%s", user.id)
        audit(
            self.user_db.session,
            actor=user,
            action="auth.login",
            entity_type="user",
            entity_id=str(user.id),
        )
        await self.user_db.session.commit()


async def get_user_db(
    session: AsyncSession = Depends(get_async_session),
) -> AsyncGenerator[SQLAlchemyUserDatabase, None]:
    """FastAPI dependency that yields a SQLAlchemyUserDatabase tied to the request session.

    Generator (``yield``) pattern ensures the session is properly closed after the
    request completes, even on exception.

    Args:
        session: Injected async session from ``get_async_session``.

    Yields:
        ``SQLAlchemyUserDatabase`` instance backed by the request-scoped session.
    """
    yield SQLAlchemyUserDatabase(session, User)


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    """FastAPI dependency that yields a ``UserManager`` for the current request.

    Chained dependency on ``get_user_db`` ensures UserManager and the DB adapter
    share the same session, keeping audit writes in the same transaction.

    Args:
        user_db: Injected ``SQLAlchemyUserDatabase`` from ``get_user_db``.

    Yields:
        Configured ``UserManager`` instance.
    """
    yield UserManager(user_db)
