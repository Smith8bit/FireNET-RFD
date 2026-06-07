import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi_users.exceptions import UserAlreadyExists, InvalidPasswordException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import current_active_user
from ..database import get_async_session
from ..database.models import Region, User, UserRegion
from ..database.schemas import OfficerRegister, PendingOfficerRead, UserCreate, UserRead
from ..db_control.permission import user_region_paths
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
    session.add(UserRegion(user_id=user.id, region_id=province.id, role="field_officer"))
    await session.commit()
    return user


# ---- admin gate: superuser / region user / province user, but NOT a field officer ----
async def current_admin(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
) -> User:
    if user.is_superuser:
        return user
    roles = (
        await session.execute(select(UserRegion.role).where(UserRegion.user_id == user.id))
    ).scalars().all()
    if any(r != "field_officer" for r in roles):
        return user
    raise HTTPException(status.HTTP_403_FORBIDDEN, "admin only")


_PENDING_SQL = """
    SELECT u.id AS user_id, u.email AS email,
           r.name_th AS province_name_th, r.path::text AS province_path
    FROM "user" u
    JOIN user_regions ur ON ur.user_id = u.id AND ur.role = 'field_officer'
    JOIN regions r ON r.id = ur.region_id
    WHERE u.is_verified = false
"""


@router.get("/pending", response_model=list[PendingOfficerRead])
async def list_pending_officers(
    admin: User = Depends(current_admin),
    session: AsyncSession = Depends(get_async_session),
):
    if admin.is_superuser:
        rows = await session.execute(text(_PENDING_SQL + ' ORDER BY u.email'))
    else:
        paths = await user_region_paths(admin, session)
        if not paths:
            return []
        rows = await session.execute(
            text(_PENDING_SQL + " AND r.path <@ ANY(CAST(:paths AS ltree[])) ORDER BY u.email")
            .bindparams(paths=paths)
        )
    return [
        PendingOfficerRead(
            user_id=m["user_id"], email=m["email"],
            province_name_th=m["province_name_th"], province_path=m["province_path"],
        )
        for m in rows.mappings().all()
    ]


@router.post("/{user_id}/verify", status_code=status.HTTP_204_NO_CONTENT)
async def verify_officer(
    user_id: uuid.UUID,
    admin: User = Depends(current_admin),
    session: AsyncSession = Depends(get_async_session),
):
    province_path = (
        await session.execute(
            select(Region.path)
            .join(UserRegion, UserRegion.region_id == Region.id)
            .where(UserRegion.user_id == user_id, UserRegion.role == "field_officer")
        )
    ).scalar_one_or_none()
    if province_path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "field officer not found")

    if not admin.is_superuser:  # must be within the admin's region scope
        ok = await session.execute(
            text(
                "SELECT 1 FROM regions r JOIN user_regions ur ON ur.region_id = r.id "
                "WHERE ur.user_id = :aid AND CAST(:p AS ltree) <@ r.path LIMIT 1"
            ).bindparams(aid=admin.id, p=province_path)
        )
        if ok.first() is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "out of your region scope")

    target = await session.get(User, user_id)
    target.is_verified = True
    await session.commit()