from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi_users.exceptions import UserAlreadyExists, InvalidPasswordException
from geoalchemy2.shape import from_shape
from shapely.geometry import Point
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.authen import current_active_user
from ..database import get_async_session
from ..database.models import FieldOfficer, Region, User, UserRegion
from ..database.schemas import OfficerRegister, PointSchema, UserCreate, UserRead
from ..db_control.users import get_user_manager, UserManager

router = APIRouter()


# ---- public: officer self-registration from the mobile app ----
@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register_officer(
    body: OfficerRegister,
    manager: UserManager = Depends(get_user_manager),
    session: AsyncSession = Depends(get_async_session),
):
    province = await session.get(Region, body.province_id)
    if province is None or province.level != "province":
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


# ---- field officer: update own location ----
@router.patch("/me/location", status_code=status.HTTP_200_OK)
async def update_my_location(
    body: PointSchema,
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    fo = (
        await session.execute(select(FieldOfficer).where(FieldOfficer.user_id == user.id))
    ).scalar_one_or_none()
    if fo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field officer record not found")
    fo.last_location = from_shape(Point(body.longitude, body.latitude), srid=4326)
    fo.last_updated = datetime.now(timezone.utc)
    fo.active = False
    await session.commit()
    return {"last_updated": fo.last_updated.isoformat()}