import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi_users.exceptions import UserAlreadyExists, InvalidPasswordException
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..auth.authen import current_active_user
from ..config import get_settings
from ..database import get_async_session
from ..database.models import (
    FieldOfficer,
    FireResolution,
    FireResolutionImage,
    Firespot,
    Region,
    User,
    UserRegion,
)
from ..database.schemas import FireAssign, OfficerRegister, OfficerStatusUpdate, UserCreate, UserRead
from ..db_control.permission import fire_visible
from ..db_control.users import get_user_manager, UserManager

settings = get_settings()

router = APIRouter()


# ---- public: officer self-registration from the mobile app ----
@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register_officer(
    body: OfficerRegister,
    manager: UserManager = Depends(get_user_manager),
    session: AsyncSession = Depends(get_async_session),
):
    province = (
        await session.execute(
            select(Region).where(Region.code == body.province_code, Region.level == "province")
        )
    ).scalar_one_or_none()
    if province is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid province")
    try:
        user = await manager.create(
            UserCreate(email=body.email, password=body.password),
            safe=True,  # forces is_verified=False and is_superuser=False
        )
    except UserAlreadyExists:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "REGISTER_USER_ALREADY_EXISTS")
    except InvalidPasswordException as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"INVALID_PASSWORD: {e.reason}")
    session.add(UserRegion(user_id=user.id, region_id=province.id, role="field_officer", name=body.name))
    await session.commit()
    return user


# ---- field officer: update own location / online status ----
@router.patch("/me/location", status_code=status.HTTP_200_OK)
async def update_my_location(
    body: OfficerStatusUpdate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    fo = (
        await session.execute(select(FieldOfficer).where(FieldOfficer.user_id == user.id))
    ).scalar_one_or_none()
    if fo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field officer record not found")
    if body.latitude is not None and body.longitude is not None:
        fo.last_location = from_shape(Point(body.longitude, body.latitude), srid=4326)
    fo.last_updated = datetime.now(timezone.utc)
    fo.active = body.active
    await session.commit()
    return {"active": fo.active, "last_updated": fo.last_updated.isoformat()}


def _fire_detail(fire: Firespot, booked: bool = True) -> dict:
    pt = to_shape(fire.location)
    detail = fire.detail or {}
    return {
        "id": str(fire.id),
        "name": fire.name,
        "detected_at": fire.detected_at.isoformat(),
        "status": fire.status,
        "expired": fire.expired,
        "booked": booked,
        "lat": pt.y,
        "lng": pt.x,
        "tumboon": detail.get("TUMBON"),
        "aumper": detail.get("AUMPER"),
        "province": detail.get("PROVINCE"),
        "type": detail.get("NAME"),
    }


async def _my_field_officer(user: User, session: AsyncSession) -> FieldOfficer:
    fo = (
        await session.execute(select(FieldOfficer).where(FieldOfficer.user_id == user.id))
    ).scalar_one_or_none()
    if fo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field officer record not found")
    return fo


# ---- field officer: reserve (จอง) a fire / clear reservation ----
# First-come-first-served: a fire can be held by at most one officer, and an
# officer holds at most one fire — a new fire cannot be reserved until the
# held one is resolved (status=True) or the reservation is cleared.
@router.patch("/me/fire", status_code=status.HTTP_200_OK)
async def reserve_fire(
    body: FireAssign,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    fo = await _my_field_officer(user, session)
    fire = None
    if body.fire_id is not None:
        if not fo.active:
            raise HTTPException(status.HTTP_409_CONFLICT, "officer offline")
        fire = await session.get(Firespot, body.fire_id)
        if fire is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "fire not found")
        region_path = (
            await session.execute(select(Region.path).where(Region.id == fire.region_id))
        ).scalar_one()
        if not await fire_visible(user, str(region_path), session):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "fire outside your assigned region")
        if fire.status:
            raise HTTPException(status.HTTP_409_CONFLICT, "fire already resolved")
        if fo.fire_id is not None and fo.fire_id != body.fire_id:
            held = await session.get(Firespot, fo.fire_id)
            if held is not None and not held.status:
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "officer already holds an unresolved fire"
                )
        holder = (
            await session.execute(
                select(FieldOfficer.id).where(
                    FieldOfficer.fire_id == body.fire_id, FieldOfficer.id != fo.id
                )
            )
        ).first()
        if holder is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "fire already reserved")
    fo.fire_id = body.fire_id
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "fire already reserved")
    return _fire_detail(fire) if fire is not None else None


def _sniff_image(data: bytes) -> str | None:
    """Identify the image type from magic bytes (headers can lie)."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

# a retry after a successful resolve (flaky field network) is treated as success
_RESOLVE_RETRY_WINDOW = timedelta(minutes=10)


def _parse_image_gps(image_gps: str | None, count: int) -> list[dict | None]:
    """image_gps: JSON array aligned with the images, [{latitude, longitude} | null, ...]."""
    if not image_gps:
        return [None] * count
    try:
        parsed = json.loads(image_gps)
        assert isinstance(parsed, list)
    except (ValueError, AssertionError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid image_gps")
    parsed = parsed[:count] + [None] * (count - len(parsed))
    out: list[dict | None] = []
    for item in parsed:
        if isinstance(item, dict) and "latitude" in item and "longitude" in item:
            out.append({"latitude": float(item["latitude"]), "longitude": float(item["longitude"])})
        else:
            out.append(None)
    return out


# ---- field officer: resolve (ดับไฟ) own reserved fire, with mandatory evidence ----
@router.post("/me/fire/resolve", status_code=status.HTTP_200_OK)
async def resolve_my_fire(
    note: str | None = Form(None),
    image_gps: str | None = Form(None),
    images: list[UploadFile] = File(...),
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    if not images:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "at least one photo is required")
    if len(images) > settings.RESOLVE_MAX_IMAGES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "too many photos")
    if note is not None and len(note) > settings.RESOLVE_NOTE_MAX_CHARS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "note too long")
    gps = _parse_image_gps(image_gps, len(images))

    fo = await _my_field_officer(user, session)
    if not fo.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "officer offline")
    if fo.fire_id is None:
        # idempotent retry: the previous attempt may have committed before the
        # response was lost — return that resolution instead of failing
        recent = (
            await session.execute(
                select(FireResolution)
                .where(
                    FireResolution.officer_id == fo.id,
                    FireResolution.created_at >= datetime.now(timezone.utc) - _RESOLVE_RETRY_WINDOW,
                )
                .order_by(FireResolution.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if recent is not None:
            fire = await session.get(Firespot, recent.fire_id)
            if fire is not None:
                return _fire_detail(fire, booked=False)
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no reserved fire")

    fire = await session.get(Firespot, fo.fire_id)
    if fire is None:
        fo.fire_id = None
        await session.commit()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "fire not found")

    # validate and read all images before touching storage or the DB
    max_bytes = settings.RESOLVE_MAX_IMAGE_MB * 1024 * 1024
    prepared: list[tuple[str, bytes, str]] = []  # (key, data, content_type)
    day = f"{datetime.now(timezone.utc):%Y%m%d}"
    for upload in images:
        data = await upload.read()
        if len(data) > max_bytes:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "photo too large")
        content_type = _sniff_image(data)
        if content_type is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "unsupported image type")
        key = f"resolutions/{day}/{fire.id}/{uuid.uuid4().hex}.{_EXT[content_type]}"
        prepared.append((key, data, content_type))

    # upload first; the DB transaction only commits if all objects are stored
    stored: list[str] = []
    try:
        for key, data, content_type in prepared:
            await storage.put_object(key, data, content_type)
            stored.append(key)
    except Exception as exc:
        await storage.remove_objects(stored)
        print(f"[resolve] evidence upload failed: {exc}")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "evidence storage unavailable")

    resolution = FireResolution(fire_id=fire.id, officer_id=fo.id, note=note or None)
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
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        await storage.remove_objects(stored)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "could not record resolution")
    return _fire_detail(fire, booked=False)


# ---- field officer: get own online status (mobile restores its state from this) ----
@router.get("/me/status")
async def my_status(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    fo = await _my_field_officer(user, session)
    return {
        "active": fo.active,
        "last_updated": fo.last_updated.isoformat() if fo.last_updated else None,
    }


# ---- field officer: get own reserved fire ----
@router.get("/me/fire")
async def my_reserved_fire(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    fo = await _my_field_officer(user, session)
    if fo.fire_id is None:
        return None
    fire = await session.get(Firespot, fo.fire_id)
    return _fire_detail(fire) if fire is not None else None