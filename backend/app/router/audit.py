"""
Append-only audit log reader — superuser access only.

All security-relevant mutations across the system write to AuditLog. This endpoint
exposes that log with composable filters. Filters are additive (AND); omitting a
filter returns all records matching the remaining constraints.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import current_superuser
from ..database import get_async_session
from ..database.models import AuditLog, User

router = APIRouter()


@router.get("")
async def list_audit(
    actor: str | None = Query(None, description="actor username substring"),
    action: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _: User = Depends(current_superuser),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Return a paginated, filtered view of the audit log.

    Action filter semantics: if `action` contains a dot it is matched exactly
    (e.g. "auth.login"); otherwise it is treated as a namespace prefix so
    "auth" matches "auth.login", "auth.revoke_user", etc. This allows
    broad scans by category without exposing an arbitrary LIKE interface.

    Args:
        actor:       Case-insensitive substring match against the actor's email.
        action:      Exact action string if it contains ".", otherwise prefix match.
        entity_type: Exact match on entity category (e.g. "user", "fire").
        entity_id:   Exact match on the affected entity's UUID string.
        since:       Inclusive lower timestamp bound (AuditLog.at >= since).
        until:       Exclusive upper timestamp bound (AuditLog.at < until).
        limit:       Page size (1–200).
        offset:      Records to skip.
        _:           Superuser guard — value unused, dependency enforces auth.
        session:     Async DB session.

    Returns:
        {
            "total": int,        # total matching records (before pagination)
            "limit": int,
            "offset": int,
            "items": [AuditLog dict, ...]
        }
    """
    stmt = select(AuditLog)
    if actor:
        stmt = stmt.where(AuditLog.actor_email.ilike(f"%{actor}%"))
    if action:
        # Dot in action string → caller wants an exact action; no dot → prefix scan.
        stmt = stmt.where(
            AuditLog.action == action
            if "." in action
            else AuditLog.action.like(f"{action}.%")
        )
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if since:
        stmt = stmt.where(AuditLog.at >= since)
    if until:
        stmt = stmt.where(AuditLog.at < until)
    total = (
        await session.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    rows = (
        (
            await session.execute(
                stmt.order_by(AuditLog.at.desc()).limit(limit).offset(offset)
            )
        )
        .scalars()
        .all()
    )
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(r.id),
                "at": r.at.isoformat(),
                "actor_id": str(r.actor_id) if r.actor_id else None,
                "actor_username": r.actor_email,
                "action": r.action,
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "detail": r.detail,
            }
            for r in rows
        ],
    }
