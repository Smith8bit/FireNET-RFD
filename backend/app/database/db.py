from typing import AsyncGenerator
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from ..config import get_settings

settings = get_settings()

# PgBouncer in transaction-pooling mode cannot handle named prepared statements
# because the same statement name may land on a different backend connection.
# Disabling the cache and generating unique names per statement prevents
# "prepared statement does not exist" errors under high concurrency.
_connect_args: dict = {}
if settings.DB_PGBOUNCER:
    _connect_args = {
        "prepared_statement_cache_size": 0,
        "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
    }

engine = create_async_engine(
    settings.DATABASE_URL,
    future=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_timeout=settings.DB_POOL_TIMEOUT,
    pool_recycle=settings.DB_POOL_RECYCLE,
    pool_pre_ping=True,   # issues a cheap SELECT 1 to discard stale idle connections
    connect_args=_connect_args,
)

# expire_on_commit=False keeps ORM objects usable after commit without
# triggering lazy re-fetches — critical in async context where implicit
# lazy loads raise MissingGreenlet errors.
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a scoped AsyncSession per request."""
    async with async_session_maker() as session:
        yield session
