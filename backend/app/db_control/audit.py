from sqlalchemy.ext.asyncio import AsyncSession

from ..database.models import AuditLog, User


def audit(
    session: AsyncSession,
    *,  # keyword-only args prevent accidental positional swaps between the many string params
    actor: User | None,
    action: str,
    entity_type: str,
    entity_id: str | None = None,
    detail: dict | None = None,
) -> None:
    """Append an immutable audit record to the current session.

    Synchronous by design — callers own the commit so multiple audit entries can
    be batched with the business-logic write in a single transaction.

    Args:
        session:     The active async SQLAlchemy session.
        actor:       User who performed the action; None for system/automated events.
        action:      Dot-separated event identifier, e.g. ``"fire.ingest"``.
        entity_type: Category of the affected resource, e.g. ``"fire"``, ``"user"``.
        entity_id:   Primary key of the affected row (str form); None for bulk events.
        detail:      Arbitrary JSON-serialisable payload for extended context.

    Returns:
        None — the record is staged on the session; the caller must ``await session.commit()``.
    """
    session.add(
        AuditLog(
            actor_id=actor.id if actor is not None else None,
            # "system" distinguishes automated entries from anonymous human actions in queries
            actor_email=actor.email if actor is not None else "system",
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            detail=detail,
        )
    )
