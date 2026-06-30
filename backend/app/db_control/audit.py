from sqlalchemy.ext.asyncio import AsyncSession

from ..database.models import AuditLog, User


def audit(
    session: AsyncSession,
    *,
    actor: User | None,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    detail: dict | None = None,
) -> None:
    session.add(
        AuditLog(
            actor_id=actor.id if actor is not None else None,
            actor_email=actor.email if actor is not None else "system",
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            detail=detail,
        )
    )
