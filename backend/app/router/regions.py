"""
Region hierarchy read endpoints backed by PostgreSQL ltree.

The region tree is encoded as ltree paths (e.g. "th.r1.p50"). The `<@` operator
("is ancestor of or equal to") lets a single WHERE clause filter the entire subtree
without recursive CTEs. Superusers bypass path filtering and see the full tree.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import current_active_user
from ..database import get_async_session
from ..database.models import Region, User
from ..database.schemas import RegionRead, ProvinceRead
from ..db_control.permission import user_region_paths

router = APIRouter()


@router.get("", response_model=list[RegionRead])
async def list_regions(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Return all regions the user can see, ordered by ltree path (depth-first).

    Superusers receive the full tree. Regular users receive only regions that
    are descendants-or-equal of their assigned region paths, which limits
    dispatchers to their own jurisdiction without multiple queries.

    Args:
        user:    Authenticated user.
        session: Async DB session.

    Returns:
        Ordered list of RegionRead objects; empty list if user has no region assignments.
    """
    if user.is_superuser:
        result = await session.execute(select(Region).order_by(Region.path))
        return result.scalars().all()
    paths = await user_region_paths(user, session)
    if not paths:
        return []
    # `<@` is PostgreSQL ltree "is ancestor-of or equal to": Region.path <@ p
    # returns rows where the stored path is within the subtree rooted at p.
    result = await session.execute(
        select(Region)
        .where(or_(*[Region.path.op("<@")(p) for p in paths]))
        .order_by(Region.path)
    )
    return result.scalars().all()


@router.get("/provinces", response_model=list[ProvinceRead])
async def list_provinces(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    """
    Return province-level regions only, used to populate region-change request dropdowns.

    The same ltree subtree filter applies for non-superusers, ensuring officers
    only see provinces within their jurisdiction. Results are ordered by Thai name
    for display purposes.

    Args:
        user:    Authenticated user.
        session: Async DB session.

    Returns:
        List of ProvinceRead objects; empty list if user has no region assignments.
    """
    stmt = select(Region).where(Region.level == "province")
    if not user.is_superuser:
        paths = await user_region_paths(user, session)
        if not paths:
            return []
        stmt = stmt.where(or_(*[Region.path.op("<@")(p) for p in paths]))
    result = await session.execute(stmt.order_by(Region.name_th))
    return result.scalars().all()
