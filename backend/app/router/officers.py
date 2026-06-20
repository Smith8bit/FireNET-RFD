import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi_users.exceptions import UserAlreadyExists, InvalidPasswordException
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..auth.authen import current_active_user
from ..config import get_settings
from ..database import get_async_session
from ..database.models import (
    DeviceToken,
    FieldOfficer,
    FireResolution,
    FireResolutionImage,
    Firespot,
    Region,
    RegionChangeRequest,
    User,
    UserRegion,
)
from ..database.schemas import (
    FireAssign,
    FireFalseReport,
    OfficerProfileUpdate,
    OfficerRegister,
    OfficerStatusUpdate,
    PushTokenDelete,
    PushTokenRegister,
    RegionChangeCreate,
    UserCreate,
    UserRead,
)
from ..db_control.audit import audit
from ..db_control.fires import get_resolution_history
from ..db_control.permission import fire_visible, user_region_paths
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
            UserCreate(email=body.username, password=body.password, division=body.division),
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
    if body.active is not None:
        # audit only the on/off transition, never routine location pings
        if body.active != fo.active:
            audit(
                session,
                actor=user,
                action="officer.online" if body.active else "officer.offline",
                entity_type="officer",
                entity_id=str(fo.id),
            )
        fo.active = body.active
    fo.last_updated = datetime.now(timezone.utc)
    await session.commit()
    return {"active": fo.active, "last_updated": fo.last_updated.isoformat()}


def _fire_detail(fire: Firespot, booked: bool = True, appointed: bool = False) -> dict:
    pt = to_shape(fire.location)
    detail = fire.detail or {}
    return {
        "id": str(fire.id),
        "name": fire.name,
        "detected_at": fire.detected_at.isoformat(),
        "status": fire.status,
        "expired": fire.expired,
        "false_alarm": fire.false_alarm,
        "booked": booked,
        "appointed": appointed,  # dispatcher-assigned → officer can't self-cancel
        "lat": pt.y,
        "lng": pt.x,
        "tumboon": detail.get("TUMBON"),
        "aumper": detail.get("AUMPER"),
        "province": detail.get("PROVINCE"),
        "type": detail.get("NAME"),
        "satellite": detail.get("SATELLITE"),
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
    # releasing a reservation: a dispatcher-appointed fire can only be cancelled by
    # a dispatcher (web console), not by the officer themselves
    if body.fire_id is None and fo.fire_id is not None and fo.appointed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "appointed fire, dispatcher-only cancel")
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
    previous_fire_id = fo.fire_id
    fo.fire_id = body.fire_id
    fo.appointed = False  # self-reserve (or clear) is never a dispatcher appointment
    if body.fire_id is not None:
        if body.fire_id != previous_fire_id:
            audit(session, actor=user, action="fire.reserve", entity_type="fire",
                  entity_id=str(fire.id), detail={"name": fire.name})
    elif previous_fire_id is not None:
        audit(session, actor=user, action="fire.release", entity_type="fire",
              entity_id=str(previous_fire_id))
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "fire already reserved")
    return _fire_detail(fire) if fire is not None else None


async def _read_capped(upload: UploadFile, max_bytes: int) -> bytes:
    """Read an upload in chunks, aborting the moment it exceeds max_bytes.

    A client must not be able to force an arbitrarily large body fully into
    memory before the size check runs; this bounds peak memory to roughly
    max_bytes + one chunk per file."""
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "photo too large")
        chunks.append(chunk)
    return b"".join(chunks)


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
            try:
                lat = float(item["latitude"])
                lng = float(item["longitude"])
            except (TypeError, ValueError):
                out.append(None)  # malformed coords are dropped, not a 500
                continue
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                out.append({"latitude": lat, "longitude": lng})
            else:
                out.append(None)  # out-of-range coords are dropped too
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
        data = await _read_capped(upload, max_bytes)
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

    resolution = FireResolution(fire_id=fire.id, officer_id=fo.id, officer_name=fo.name, note=note or None)
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
    audit(session, actor=user, action="fire.resolve", entity_type="fire", entity_id=str(fire.id),
          detail={"name": fire.name, "resolution_id": str(resolution.id), "images": len(prepared)})
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        await storage.remove_objects(stored)
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "could not record resolution")
    return _fire_detail(fire, booked=False)


# ---- field officer: report own reserved fire as a false alarm (no evidence) ----
# Satellite hotspot detection has false positives; an on-site officer who finds no
# real fire closes it here instead of being forced to fake "fire put out" photos.
@router.post("/me/fire/false-report", status_code=status.HTTP_200_OK)
async def false_report_my_fire(
    body: FireFalseReport,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    note = body.note
    if note is not None and len(note) > settings.RESOLVE_NOTE_MAX_CHARS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "note too long")

    fo = await _my_field_officer(user, session)
    if not fo.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "officer offline")
    if fo.fire_id is None:
        # idempotent retry: a prior attempt may have committed before its response was lost
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

    # records who reported it false and why; no images, unlike a real resolution
    resolution = FireResolution(fire_id=fire.id, officer_id=fo.id, officer_name=fo.name, note=note or None)
    session.add(resolution)
    await session.flush()
    fo.fire_id = None
    fire.status = True
    fire.false_alarm = True
    fire.resolve_time = datetime.now(timezone.utc)
    audit(session, actor=user, action="fire.false_report", entity_type="fire", entity_id=str(fire.id),
          detail={"name": fire.name, "resolution_id": str(resolution.id)})
    try:
        await session.commit()
    except Exception:
        await session.rollback()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "could not record false report")
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
    return _fire_detail(fire, appointed=fo.appointed) if fire is not None else None


# ---- field officer: register / remove this device's FCM push token ----
@router.put("/me/push-token", status_code=status.HTTP_204_NO_CONTENT)
async def register_push_token(
    body: PushTokenRegister,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    # a token is globally unique to one device; if it moves to a new account
    # (shared phone, re-login), reassign it rather than rejecting the insert
    stmt = (
        insert(DeviceToken)
        .values(user_id=user.id, token=body.token, platform=body.platform)
        .on_conflict_do_update(
            index_elements=["token"],
            set_={"user_id": user.id, "platform": body.platform, "last_seen": func.now()},
        )
    )
    await session.execute(stmt)
    await session.commit()


@router.delete("/me/push-token", status_code=status.HTTP_204_NO_CONTENT)
async def delete_push_token(
    body: PushTokenDelete,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    # scoped to the caller so one account can't unregister another's device
    await session.execute(
        delete(DeviceToken).where(
            DeviceToken.token == body.token, DeviceToken.user_id == user.id
        )
    )
    await session.commit()


# ---- field officer: update own display name ----
@router.patch("/me/profile", status_code=status.HTTP_200_OK)
async def update_my_profile(
    body: OfficerProfileUpdate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "name required")
    # name lives on both the region assignment (source of truth) and the officer row
    ur = (
        await session.execute(
            select(UserRegion).where(
                UserRegion.user_id == user.id, UserRegion.role == "field_officer"
            )
        )
    ).scalar_one_or_none()
    if ur is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field officer record not found")
    ur.name = name
    await session.execute(
        update(FieldOfficer).where(FieldOfficer.user_id == user.id).values(name=name)
    )
    # division (สังกัด) is optional; only overwrite when the client sends it
    if body.division is not None:
        user.division = body.division.strip() or None
    await session.commit()
    return {"name": name, "division": user.division}


# ---- field officer: request a move to another province (dispatcher approves) ----
@router.post("/me/region-change", status_code=status.HTTP_201_CREATED)
async def request_region_change(
    body: RegionChangeCreate,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
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
                UserRegion.user_id == user.id, UserRegion.role == "field_officer"
            )
        )
    ).scalar_one_or_none()
    if ur is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field officer record not found")
    if ur.region_id == province.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "already in this province")

    req = RegionChangeRequest(user_id=user.id, requested_region_id=province.id)
    session.add(req)
    audit(session, actor=user, action="region_change.request", entity_type="user",
          entity_id=str(user.id), detail={"province_code": province.code, "province_path": str(province.path)})
    try:
        await session.commit()
    except IntegrityError:  # partial unique index: one open request per officer
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "a request is already pending")
    return {"id": str(req.id), "status": req.status, "province": province.name_th}


# ---- field officer: own latest region-change request (null if never asked) ----
@router.get("/me/region-change")
async def my_region_change(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
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


# ---- field officer: own resolution history (newest first, paged) ----
@router.get("/me/resolutions")
async def my_resolutions(
    limit: int = 20,
    offset: int = 0,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    fo = await _my_field_officer(user, session)
    return await get_resolution_history(user=user, limit=limit, offset=offset, officer_id=fo.id)


# ---- field officer: monthly leaderboard (real fires resolved this month, region-scoped) ----
@router.get("/me/leaderboard")
async def my_leaderboard(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    fo = await _my_field_officer(user, session)
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    stmt = (
        select(
            FieldOfficer.id,
            FieldOfficer.name,
            func.count(FireResolution.id).label("cnt"),
        )
        .join(FireResolution, FireResolution.officer_id == FieldOfficer.id)
        .join(Firespot, Firespot.id == FireResolution.fire_id)
        # rank by the officer's *current* region, not the fire's — a reassigned
        # officer moves to their new province's board, carrying past resolutions
        .join(
            UserRegion,
            (UserRegion.user_id == FieldOfficer.user_id) & (UserRegion.role == "field_officer"),
        )
        .join(Region, Region.id == UserRegion.region_id)
        .where(Firespot.false_alarm.is_(False), FireResolution.created_at >= month_start)
        .group_by(FieldOfficer.id, FieldOfficer.name)
        .order_by(func.count(FireResolution.id).desc())
        .limit(50)
    )
    if not user.is_superuser:
        paths = await user_region_paths(user, session)
        if not paths:
            return {"month": month_start.date().isoformat(), "items": []}
        stmt = stmt.where(or_(*[Region.path.op("<@")(p) for p in paths]))
    rows = (await session.execute(stmt)).all()
    return {
        "month": month_start.date().isoformat(),
        "items": [
            {"rank": i + 1, "name": name or "—", "count": cnt, "is_me": fid == fo.id}
            for i, (fid, name, cnt) in enumerate(rows)
        ],
    }