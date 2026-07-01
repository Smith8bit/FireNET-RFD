"""
User management endpoints — all mutating operations are superuser-only.

The list endpoint enriches each user row with a live active-session count derived
from non-expired, non-revoked RefreshTokens. Revocation deactivates the account
AND invalidates all sessions atomically so there is no window where a deactivated
user can still use an existing token.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.authen import current_active_user, current_superuser
from ..auth.refresh import revoke_all_for_user
from ..database import get_async_session
from ..database.models import Region, RefreshToken, User, UserRegion
from ..db_control.audit import audit
from ..db_control.permission import is_admin_user, is_field_officer, user_permissions
from ..db_control.region_view import region_view

router = APIRouter()


@router.get("/me/profile")
async def get_my_profile(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Return the calling user's full profile including role flags and permissions.

    The region assignment query selects the shallowest (lowest nlevel) UserRegion
    to surface the top-level jurisdiction rather than a deeply nested sub-region.

    Args:
        user:    Authenticated calling user.
        session: Async DB session.

    Returns:
        Profile dict with identity, role booleans, home region, and sorted permission list.
    """
    # Shallowest region = broadest jurisdiction; used as the user's "home" display.
    row = (
        await session.execute(
            select(UserRegion.name, Region.code)
            .join(Region, Region.id == UserRegion.region_id)
            .where(UserRegion.user_id == user.id)
            .order_by(func.nlevel(Region.path))
            .limit(1)
        )
    ).first()
    name, region_code = row if row is not None else (None, None)

    return {
        "id": str(user.id),
        "username": user.email,
        "division": user.division,
        "is_active": user.is_active,
        "is_superuser": user.is_superuser,
        "is_verified": user.is_verified,
        "name": name,
        "home": region_view(region_code),
        "is_admin": await is_admin_user(user, session),
        "is_field_officer": await is_field_officer(user, session),
        "permissions": sorted(await user_permissions(user, session)),
    }


@router.get("/list")
async def list_users(
    q: str | None = None,
    status: str | None = None,
    division: str | None = None,
    sort: str = "name",
    order: str = "asc",
    limit: int = 50,
    offset: int = 0,
    _su: User = Depends(current_superuser),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Paginated user list with live session counts — superuser only.

    The active-session count is computed via a LEFT JOIN on a subquery that
    counts non-expired, non-revoked RefreshTokens per user, making it cheap
    to surface "is anyone currently logged in?" without a separate API call.
    Limit is server-capped at 200 to prevent runaway queries regardless of the
    caller-supplied value.

    Args:
        q:        Case-insensitive substring filter on email or division.
        status:   "active" | "suspended" | None (all).
        division: Exact division name filter.
        sort:     "name" (default) or "sessions" to sort by active session count.
        order:    "asc" (default) or "desc".
        limit:    Page size (server-capped at 200).
        offset:   Records to skip (floored at 0).
        _su:      Superuser guard — value unused, dependency enforces auth.
        session:  Async DB session.

    Returns:
        {"total": int, "divisions": [str], "items": [...]}
    """
    # Subquery: count active (non-expired, non-revoked) sessions per user.
    live = (
        select(RefreshToken.user_id, func.count().label("n"))
        .where(RefreshToken.revoked_at.is_(None), RefreshToken.expires_at > func.now())
        .group_by(RefreshToken.user_id)
        .subquery()
    )
    n_col = func.coalesce(live.c.n, 0)
    stmt = select(User, n_col).outerjoin(live, live.c.user_id == User.id)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(User.email).like(like),
                func.lower(func.coalesce(User.division, "")).like(like),
            )
        )
    if status == "active":
        stmt = stmt.where(User.is_active.is_(True))
    elif status == "suspended":
        stmt = stmt.where(User.is_active.is_(False))
    if division:
        stmt = stmt.where(User.division == division)
    total = (
        await session.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    sort_col = n_col if sort == "sessions" else func.lower(User.email)
    sort_col = sort_col.desc() if order == "desc" else sort_col.asc()
    rows = (
        await session.execute(
            stmt.order_by(sort_col).limit(min(limit, 200)).offset(max(offset, 0))
        )
    ).all()
    divisions = (
        (
            await session.execute(
                select(User.division)
                .where(User.division.is_not(None))
                .distinct()
                .order_by(User.division)
            )
        )
        .scalars()
        .all()
    )
    return {
        "total": total,
        "divisions": divisions,
        "items": [
            {
                "id": str(u.id),
                "username": u.email,
                "division": u.division,
                "is_active": u.is_active,
                "is_superuser": u.is_superuser,
                "is_verified": u.is_verified,
                "active_sessions": n,
            }
            for u, n in rows
        ],
    }


@router.post("/{user_id}/revoke")
async def revoke_user(
    user_id: uuid.UUID,
    su: User = Depends(current_superuser),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Deactivate a user account and immediately revoke all their active sessions.

    Guards prevent a superuser from revoking themselves or another superuser —
    both would risk losing all admin access to the system.

    Args:
        user_id: UUID of the user to suspend.
        su:      Calling superuser (used for self-check and audit record).
        session: Async DB session.

    Returns:
        {"ok": True}

    Raises:
        HTTPException(400): Attempting to revoke self or another superuser.
        HTTPException(404): Target user not found.
    """
    if user_id == su.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="cannot_revoke_self")
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="user_not_found")
    if target.is_superuser:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, detail="cannot_revoke_superuser"
        )
    target.is_active = False
    await revoke_all_for_user(session, user_id)
    audit(
        session,
        actor=su,
        action="auth.revoke_user",
        entity_type="user",
        entity_id=str(user_id),
        detail={"name": target.email},
    )
    await session.commit()
    return {"ok": True}


@router.post("/{user_id}/restore")
async def restore_user(
    user_id: uuid.UUID,
    su: User = Depends(current_superuser),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Re-activate a previously suspended user account.

    Restoring does not re-issue tokens; the user must log in again.
    The audit trail from the original revocation is preserved.

    Args:
        user_id: UUID of the user to restore.
        su:      Calling superuser (for audit record).
        session: Async DB session.

    Returns:
        {"ok": True}

    Raises:
        HTTPException(404): Target user not found.
    """
    target = await session.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="user_not_found")
    target.is_active = True
    audit(
        session,
        actor=su,
        action="auth.restore_user",
        entity_type="user",
        entity_id=str(user_id),
        detail={"name": target.email},
    )
    await session.commit()
    return {"ok": True}
