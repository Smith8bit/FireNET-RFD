"""
Fire resolution endpoints — confirmed resolution and false-alarm reporting.

Evidence (images) are uploaded to object storage before the DB record is written.
If the DB commit fails, stored objects are deleted to prevent orphaned files.
The reverse is not true: if storage upload fails, no DB record is created.

An idempotency window (`RESOLVE_RETRY_MINUTES`) handles the common mobile edge case
where the officer's app retries after a network error that actually succeeded on the
server. Within the window, re-submission returns the already-resolved fire instead
of 404 or a duplicate resolution error.
"""

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

# How long after a successful resolve to treat a re-submission as idempotent.
_RESOLVE_RETRY_WINDOW = timedelta(minutes=settings.RESOLVE_RETRY_MINUTES)


async def _find_recent_resolve(
    session: AsyncSession, fo: FieldOfficer
) -> FireDetail | None:
    """
    Look for a resolution submitted by *fo* within the idempotency window.

    If found, returns the associated fire so the caller can return it as if
    this request were the original — making re-submission safe for mobile clients
    that cannot distinguish network failure from server failure.

    Args:
        session: Async DB session.
        fo:      The FieldOfficer whose recent resolution to search for.

    Returns:
        FireDetail of the recently resolved fire, or None if no recent resolution exists.
    """
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
    """
    Mark the officer's booked fire as resolved with photo evidence.

    Upload sequence:
      1. Validate all inputs (count, size, type) before touching storage.
      2. Upload images to object storage and track stored keys.
      3. Flush DB to obtain resolution.id (needed as FK for image rows).
      4. Commit atomically; on failure, delete the already-uploaded objects.

    Image content-type is sniffed from the file bytes rather than trusting the
    multipart header, to prevent type confusion when serving evidence back.

    Object storage keys follow: `resolutions/{YYYYMMDD}/{fire_id}/{uuid}.{ext}`

    Args:
        note:      Optional text note (length bounded by settings.RESOLVE_NOTE_MAX_CHARS).
        image_gps: JSON string mapping image index → GPS coordinates (optional).
        images:    One or more uploaded image files (required, up to RESOLVE_MAX_IMAGES).
        user:      Authenticated field officer.
        session:   Async DB session.

    Returns:
        FireDetail of the now-resolved fire.

    Raises:
        HTTPException(400): No images, too many images, note too long, or unsupported image type.
        HTTPException(404): No reserved fire (with idempotency fallback if within retry window).
        HTTPException(409): Officer is offline.
        HTTPException(502): Object storage upload failed.
        HTTPException(500): DB commit failed (uploaded objects are rolled back).
    """
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
        # No current booking — check if this is a retry within the idempotency window.
        retry = await _find_recent_resolve(session, fo)
        if retry is not None:
            return retry
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no reserved fire")
    fire = await session.get(Firespot, fo.fire_id)
    if fire is None:
        # Fire was deleted externally — clean up the dangling FK before erroring.
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
        # Roll back any objects already uploaded before the failure.
        await storage.remove_objects(stored)
        print(f"[resolve] evidence upload failed: {exc}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "evidence storage unavailable")
    resolution = FireResolution(
        fire_id=fire.id, officer_id=fo.id, officer_name=fo.name, note=note or None
    )
    session.add(resolution)
    # Flush to generate resolution.id before image rows reference it as a FK.
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
        # DB failed after storage succeeded — delete orphaned objects to stay consistent.
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
    """
    Mark the officer's booked fire as a false alarm (no photo evidence required).

    Sets `fire.false_alarm = True` in addition to `fire.status = True`, which
    excludes this fire from leaderboard counts and resolution history statistics.
    Shares the same idempotency window as `resolve_my_fire`.

    Args:
        body:    FireFalseReport with optional `note`.
        user:    Authenticated field officer.
        session: Async DB session.

    Returns:
        FireDetail of the now-closed fire.

    Raises:
        HTTPException(400): Note too long.
        HTTPException(404): No reserved fire (with idempotency fallback).
        HTTPException(409): Officer is offline.
        HTTPException(500): DB commit failed.
    """
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
    """
    Return a paginated history of fires resolved by the calling officer.

    Args:
        limit:   Page size (default 20).
        offset:  Records to skip (default 0).
        user:    Authenticated field officer.
        session: Async DB session.

    Returns:
        {"total": int, "items": [...]}
    """
    fo = await get_field_officer(user, session)
    return await get_resolution_history(
        user=user, limit=limit, offset=offset, officer_id=fo.id
    )
