import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..auth.authen import current_active_user
from ..database import get_async_session
from ..database.models import FieldOfficer, FireResolution, FireResolutionImage, Firespot, Region, User
from ..db_control.fires import get_fires, get_resolution_history
from ..db_control.permission import fire_visible

router = APIRouter()


@router.get("")
async def list_fires(user: User = Depends(current_active_user)):
    return await get_fires(user=user)


@router.get("/resolutions")
async def list_resolutions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    false_alarm: bool | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    user: User = Depends(current_active_user),
):
    return await get_resolution_history(
        user=user, limit=limit, offset=offset,
        false_alarm=false_alarm, since=since, until=until,
    )


async def _visible_fire_or_404(fire_id: uuid.UUID, user: User, session: AsyncSession) -> Firespot:
    fire = await session.get(Firespot, fire_id)
    if fire is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "fire not found")
    region_path = (
        await session.execute(select(Region.path).where(Region.id == fire.region_id))
    ).scalar_one()
    if not await fire_visible(user, str(region_path), session):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "fire outside your assigned region")
    return fire


# ---- resolution evidence (note + photos) for a resolved fire ----
@router.get("/{fire_id}/resolution")
async def get_fire_resolution(
    fire_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    await _visible_fire_or_404(fire_id, user, session)
    resolution = (
        await session.execute(select(FireResolution).where(FireResolution.fire_id == fire_id))
    ).scalar_one_or_none()
    if resolution is None:
        return None  # unresolved, or auto-expired
    officer_name = None
    if resolution.officer_id is not None:
        officer_name = (
            await session.execute(
                select(FieldOfficer.name).where(FieldOfficer.id == resolution.officer_id)
            )
        ).scalar_one_or_none()
    images = (
        await session.execute(
            select(FireResolutionImage)
            .where(FireResolutionImage.resolution_id == resolution.id)
            .order_by(FireResolutionImage.created_at)
        )
    ).scalars().all()
    return {
        "id": str(resolution.id),
        "note": resolution.note,
        "officer_name": officer_name,
        "created_at": resolution.created_at.isoformat(),
        "images": [
            {
                "id": str(img.id),
                "content_type": img.content_type,
                "size_bytes": img.size_bytes,
                "latitude": img.latitude,
                "longitude": img.longitude,
            }
            for img in images
        ],
    }


# images are served through the API (not presigned URLs) so the same region
# scoping applies to evidence reads as to everything else
@router.get("/{fire_id}/images/{image_id}")
async def get_fire_image(
    fire_id: uuid.UUID,
    image_id: uuid.UUID,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    await _visible_fire_or_404(fire_id, user, session)
    image = (
        await session.execute(
            select(FireResolutionImage)
            .join(FireResolution, FireResolution.id == FireResolutionImage.resolution_id)
            .where(FireResolution.fire_id == fire_id, FireResolutionImage.id == image_id)
        )
    ).scalar_one_or_none()
    if image is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "image not found")
    try:
        data = await storage.get_object(image.object_key)
    except Exception as exc:
        print(f"[fires] image fetch failed for {image.object_key}: {exc}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "evidence storage unavailable")
    return Response(
        content=data,
        media_type=image.content_type,
        headers={"Cache-Control": "private, max-age=86400"},
    )
