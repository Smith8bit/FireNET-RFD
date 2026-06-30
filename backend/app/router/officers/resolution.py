import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ... import storage
from ...auth.authen import current_active_user
from ...config import get_settings
from ...database import get_async_session
from ...database.models import (
    FieldOfficer,
    FireResolution,
    FireResolutionImage,
    Firespot,
    User,
)
from ...database.schemas import FireFalseReport
from ...db_control.audit import audit
from ...db_control.fires import FireDetail, build_fire_detail, get_resolution_history
from ._helpers import get_field_officer

settings = get_settings()
router = APIRouter()

_RESOLVE_RETRY_WINDOW = timedelta(minutes=settings.RESOLVE_RETRY_MINUTES)


async def _find_recent_resolve(
    session: AsyncSession, fo: FieldOfficer
) -> FireDetail | None:
    recent = (
        await session.execute(
            select(FireResolution)
            .where(
                FireResolution.officer_id == fo.id,
                FireResolution.created_at
                >= datetime.now(timezone.utc) - _RESOLVE_RETRY_WINDOW,
            )
            .order_by(FireResolution.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if recent is not None:
        fire = await session.get(Firespot, recent.fire_id)
        if fire is not None:
            return build_fire_detail(fire, booked=False)
    return None


@router.post("/me/fire/resolve", status_code=status.HTTP_200_OK)
async def resolve_my_fire(
    note: str | None = Form(None),
    image_gps: str | None = Form(None),
    images: list[UploadFile] = File(...),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> FireDetail:
    if not images:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "at least one photo is required"
        )
    if len(images) > settings.RESOLVE_MAX_IMAGES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "too many photos")
    if note is not None and len(note) > settings.RESOLVE_NOTE_MAX_CHARS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "note too long")
    gps = storage.parse_image_gps(image_gps, len(images))

    fo = await get_field_officer(user, session)
    if not fo.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "officer offline")
    if fo.fire_id is None:
        retry = await _find_recent_resolve(session, fo)
        if retry is not None:
            return retry
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no reserved fire")
    fire = await session.get(Firespot, fo.fire_id)
    if fire is None:
        fo.fire_id = None
        await session.commit()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "fire not found")
    max_bytes = settings.RESOLVE_MAX_IMAGE_MB * 1024 * 1024
    prepared: list[tuple[str, bytes, str]] = []
    day = f"{datetime.now(timezone.utc):%Y%m%d}"
    for upload in images:
        data = await storage.read_capped(upload, max_bytes)
        content_type = storage.sniff_image(data)
        if content_type is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "unsupported image type")
        key = f"resolutions/{day}/{fire.id}/{uuid.uuid4().hex}.{storage.IMAGE_EXT[content_type]}"
        prepared.append((key, data, content_type))
    stored: list[str] = []
    try:
        for key, data, content_type in prepared:
            await storage.put_object(key, data, content_type)
            stored.append(key)
    except Exception as exc:
        await storage.remove_objects(stored)
        print(f"[resolve] evidence upload failed: {exc}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "evidence storage unavailable")
    resolution = FireResolution(
        fire_id=fire.id, officer_id=fo.id, officer_name=fo.name, note=note or None
    )
    session.add(resolution)
    await session.flush()
    for (key, data, content_type), point in zip(prepared, gps):
        session.add(
            FireResolutionImage(
                resolution_id=resolution.id,
                object_key=key,
                content_type=content_type,
                size_bytes=len(data),
                latitude=point["latitude"] if point else None,
                longitude=point["longitude"] if point else None,
            )
        )
    fo.fire_id = None
    fire.status = True
    fire.resolve_time = datetime.now(timezone.utc)
    audit(
        session,
        actor=user,
        action="fire.resolve",
        entity_type="fire",
        entity_id=str(fire.id),
        detail={
            "name": fire.name,
            "resolution_id": str(resolution.id),
            "images": len(prepared),
        },
    )
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        await storage.remove_objects(stored)
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "could not record resolution"
        )
    return build_fire_detail(fire, booked=False)


@router.post("/me/fire/false-report", status_code=status.HTTP_200_OK)
async def false_report_my_fire(
    body: FireFalseReport,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> FireDetail:
    note = body.note
    if note is not None and len(note) > settings.RESOLVE_NOTE_MAX_CHARS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "note too long")
    fo = await get_field_officer(user, session)
    if not fo.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "officer offline")
    if fo.fire_id is None:
        retry = await _find_recent_resolve(session, fo)
        if retry is not None:
            return retry
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no reserved fire")
    fire = await session.get(Firespot, fo.fire_id)
    if fire is None:
        fo.fire_id = None
        await session.commit()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "fire not found")
    resolution = FireResolution(
        fire_id=fire.id, officer_id=fo.id, officer_name=fo.name, note=note or None
    )
    session.add(resolution)
    await session.flush()
    fo.fire_id = None
    fire.status = True
    fire.false_alarm = True
    fire.resolve_time = datetime.now(timezone.utc)
    audit(
        session,
        actor=user,
        action="fire.false_report",
        entity_type="fire",
        entity_id=str(fire.id),
        detail={"name": fire.name, "resolution_id": str(resolution.id)},
    )
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "could not record false report"
        )
    return build_fire_detail(fire, booked=False)


@router.get("/me/resolutions")
async def my_resolutions(
    limit: int = 20,
    offset: int = 0,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> dict:
    fo = await get_field_officer(user, session)
    return await get_resolution_history(
        user=user, limit=limit, offset=offset, officer_id=fo.id
    )
