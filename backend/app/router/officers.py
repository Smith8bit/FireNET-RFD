from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi_users.exceptions import UserAlreadyExists, InvalidPasswordException
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.authen import current_active_user
from ..database import get_async_session
from ..database.models import FieldOfficer, Firespot, Region, User, UserRegion
from ..database.schemas import FireAssign, OfficerRegister, OfficerStatusUpdate, UserCreate, UserRead
from ..db_control.permission import fire_visible
from ..db_control.users import get_user_manager, UserManager

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


# ---- field officer: resolve (ดับไฟ) own reserved fire ----
@router.post("/me/fire/resolve", status_code=status.HTTP_200_OK)
async def resolve_my_fire(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    fo = await _my_field_officer(user, session)
    if not fo.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "officer offline")
    if fo.fire_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no reserved fire")
    fire = await session.get(Firespot, fo.fire_id)
    fo.fire_id = None
    if fire is None:
        await session.commit()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "fire not found")
    fire.status = True
    fire.resolve_time = datetime.now(timezone.utc)
    await session.commit()
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