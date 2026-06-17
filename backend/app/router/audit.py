from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import current_superuser
from ..database import get_async_session
from ..database.models import AuditLog, User

router = APIRouter()


# regional scoping deferred — the trail is superuser-only for now
@router.get("")
async def list_audit(
    actor: str | None = Query(None, description="actor email substring"),
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
    stmt = select(AuditLog)
    if actor:
        stmt = stmt.where(AuditLog.actor_email.ilike(f"%{actor}%"))
    if action:
        # a bare category ("fire") matches all of its actions; a full
        # "fire.reserve" still matches exactly. ponytail: prefix filter
        stmt = stmt.where(
            AuditLog.action == action if "." in action
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
        await session.execute(stmt.order_by(AuditLog.at.desc()).limit(limit).offset(offset))
    ).scalars().all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(r.id),
                "at": r.at.isoformat(),
                "actor_id": str(r.actor_id) if r.actor_id else None,
                "actor_email": r.actor_email,
                "action": r.action,
                "entity_type": r.entity_type,
                "entity_id": r.entity_id,
                "detail": r.detail,
            }
            for r in rows
        ],
    }
