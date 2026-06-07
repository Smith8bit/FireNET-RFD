import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import current_active_user, current_superuser
from ..database import get_async_session
from ..database.models import Region, User, UserRegion
from ..database.schemas import RegionRead, UserRegionAssign, ProvinceRead
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
    rows = await session.execute(
        text(
            "SELECT * FROM regions WHERE path <@ ANY(CAST(:paths AS ltree[])) ORDER BY path"
        ).bindparams(paths=paths)
    )
    return [
        RegionRead(
            id=r.id,
            code=r.code,
            name_th=r.name_th,
            name_en=r.name_en,
            level=r.level,
            path=r.path,
            parent_id=r.parent_id,
        )
        for r in rows.mappings().all()
    ]


@router.post("/users/{user_id}/assign", status_code=status.HTTP_201_CREATED)
async def assign_user_region(
    user_id: uuid.UUID,
    body: UserRegionAssign,
    _: User = Depends(current_superuser),
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
    await session.commit()
    return {"ok": True}


@router.delete("/users/{user_id}/assign/{region_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_user_region(
    user_id: uuid.UUID,
    region_id: uuid.UUID,
    _: User = Depends(current_superuser),
    session: AsyncSession = Depends(get_async_session),
):
    existing = await session.get(UserRegion, (user_id, region_id))
    if existing is None:
        return
    await session.delete(existing)
    await session.commit()

@router.get("/provinces", response_model=list[ProvinceRead])
async def list_provinces(session: AsyncSession = Depends(get_async_session)):
    result = await session.execute(
        select(Region).where(Region.level == "province").order_by(Region.name_th)
    )
    return result.scalars().all()