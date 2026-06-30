from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ...auth.authen import current_active_user
from ...database import get_async_session
from ...database.models import Region, RegionChangeRequest, User, UserRegion
from ...database.schemas import RegionChangeCreate, UserRole
from ...db_control.audit import audit

router = APIRouter()


@router.post("/me/region-change", status_code=status.HTTP_201_CREATED)
async def request_region_change(
    body: RegionChangeCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict[str, str]:
    province = (
        await session.execute(
            select(Region).where(Region.code == body.province_code, Region.level == "province")
        )
    ).scalar_one_or_none()
    if province is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid province")

    ur = (
        await session.execute(
            select(UserRegion).where(
                UserRegion.user_id == user.id,
                UserRegion.role == UserRole.FIELD_OFFICER,
            )
        )
    ).scalar_one_or_none()
    if ur is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field officer record not found")
    if ur.region_id == province.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "already in this province")

    previous = (
        await session.execute(select(Region).where(Region.id == ur.region_id))
    ).scalar_one_or_none()

    req = RegionChangeRequest(user_id=user.id, requested_region_id=province.id)
    session.add(req)
    detail: dict[str, str] = {
        "province_code": province.code,
        "province_path": str(province.path),
    }
    if previous is not None:
        detail["previous_province_code"] = previous.code
        detail["previous_province_path"] = str(previous.path)
    audit(
        session,
        actor=user,
        action="region_change.request",
        entity_type="user",
        entity_id=str(user.id),
        detail=detail,
    )
    try:
        await session.commit()
    except IntegrityError:  # partial unique index: one open request per officer
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "a request is already pending")
    return {"id": str(req.id), "status": req.status, "province": province.name_th}


@router.get("/me/region-change")
async def my_region_change(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict | None:
    row = (
        await session.execute(
            select(RegionChangeRequest, Region.name_th)
            .join(Region, Region.id == RegionChangeRequest.requested_region_id)
            .where(RegionChangeRequest.user_id == user.id)
            .order_by(RegionChangeRequest.created_at.desc())
            .limit(1)
        )
    ).first()
    if row is None:
        return None
    req, province = row
    return {
        "id": str(req.id),
        "status": req.status,
        "province": province,
        "created_at": req.created_at.isoformat(),
        "decided_at": req.decided_at.isoformat() if req.decided_at else None,
    }
