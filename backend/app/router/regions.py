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
    if user.is_superuser:
        result = await session.execute(select(Region).order_by(Region.path))
        return result.scalars().all()
    paths = await user_region_paths(user, session)
    if not paths:
        return []
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
    stmt = select(Region).where(Region.level == "province")
    if not user.is_superuser:
        paths = await user_region_paths(user, session)
        if not paths:
            return []
        stmt = stmt.where(or_(*[Region.path.op("<@")(p) for p in paths]))
    result = await session.execute(stmt.order_by(Region.name_th))
    return result.scalars().all()
