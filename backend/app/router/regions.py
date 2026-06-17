import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import current_active_user, current_superuser
from ..database import get_async_session
from ..database.models import Region, User, UserRegion
from ..database.schemas import RegionRead, UserRegionAssign, ProvinceRead
from ..db_control.audit import audit
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


@router.post("/users/{user_id}/assign", status_code=status.HTTP_201_CREATED)
async def assign_user_region(
    user_id: uuid.UUID,
    body: UserRegionAssign,
    actor: User = Depends(current_superuser),
    session: AsyncSession = Depends(get_async_session),
):
    region = await session.get(Region, body.region_id)
    if region is None:
        raise HTTPException(404, "region not found")
    existing = await session.get(UserRegion, (user_id, body.region_id))
    if existing:
        existing.role = body.role
    else:
        session.add(UserRegion(user_id=user_id, region_id=body.region_id, role=body.role))
    audit(session, actor=actor, action="region.assign", entity_type="user", entity_id=str(user_id),
          detail={"region_id": str(body.region_id), "region_path": str(region.path), "role": body.role})
    await session.commit()
    return {"ok": True}


@router.delete("/users/{user_id}/assign/{region_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_user_region(
    user_id: uuid.UUID,
    region_id: uuid.UUID,
    actor: User = Depends(current_superuser),
    session: AsyncSession = Depends(get_async_session),
):
    existing = await session.get(UserRegion, (user_id, region_id))
    if existing is None:
        return
    region = await session.get(Region, region_id)
    audit(session, actor=actor, action="region.revoke", entity_type="user", entity_id=str(user_id),
          detail={"region_id": str(region_id),
                  "region_path": str(region.path) if region else None,
                  "role": existing.role})
    await session.delete(existing)
    await session.commit()

@router.get("/provinces", response_model=list[ProvinceRead])
async def list_provinces(session: AsyncSession = Depends(get_async_session)):
    result = await session.execute(
        select(Region).where(Region.level == "province").order_by(Region.name_th)
    )
    return result.scalars().all()