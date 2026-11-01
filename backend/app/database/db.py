from typing import AsyncGenerator
from uuid import uuid4

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Session

from ..config import get_settings

settings = get_settings()

# Postgres schema holding Test-mode mirror copies of the fire-drill tables
# (see db_control/test_mode.py). Shared tables (user, regions, ...) exist only in public.
TEST_SCHEMA = "test"

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

class ModeAwareSession(Session):
    """Sync session behind every AsyncSession; routes Test-mode sessions (see below)."""


@event.listens_for(ModeAwareSession, "after_begin")
def _route_test_session(session, transaction, connection) -> None:
    """Point unqualified table names at the test schema for Test-mode sessions.

    Only sessions opened with ``info={"test": True}`` are affected, so every other
    session keeps hitting production tables untouched. Tables that have no test copy
    (user, regions, ...) still resolve to public via the search_path fallback.
    SET LOCAL lasts only for this transaction, so a pooled connection never carries
    the test search_path into a later checkout (also safe under PgBouncer).
    """
    if session.info.get("test"):
        connection.exec_driver_sql(f"SET LOCAL search_path TO {TEST_SCHEMA}, public")


# expire_on_commit=False keeps ORM objects usable after commit without
# triggering lazy re-fetches — critical in async context where implicit
# lazy loads raise MissingGreenlet errors.
async_session_maker = async_sessionmaker(
    engine, expire_on_commit=False, sync_session_class=ModeAwareSession
)


class Base(DeclarativeBase):
    pass


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a scoped AsyncSession per request."""
    async with async_session_maker() as session:
        yield session
