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
