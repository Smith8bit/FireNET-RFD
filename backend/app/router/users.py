from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.authen import current_active_user
from ..database import get_async_session
from ..database.models import Region, User, UserRegion
from ..db_control.permission import is_admin_user, is_field_officer
from ..db_control.region_view import region_view

router = APIRouter()


@router.get("/me/profile")
async def get_my_profile(
    user: User = Depends(current_active_user),
    session: AsyncSession = Depends(get_async_session),
):
    # broadest assigned region (shortest ltree path) drives both the display name
    # and the map's opening view — for the usual single assignment it's just that
    # region, and for a multi-region user it's the one covering all the others.
    row = (
        await session.execute(
            select(UserRegion.name, Region.code)
            .join(Region, Region.id == UserRegion.region_id)
            .where(UserRegion.user_id == user.id)
            .order_by(func.nlevel(Region.path))
            .limit(1)
        )
    ).first()
    name, region_code = row if row is not None else (None, None)

    return {
        "id": str(user.id),
        "email": user.email,
        "is_active": user.is_active,
        "is_superuser": user.is_superuser,
        "is_verified": user.is_verified,
        "name": name,
        # opening map view {lat, lng, zoom} for this user's region
        "home": region_view(region_code),
        # platform gating: web requires is_admin, mobile requires is_field_officer
        "is_admin": await is_admin_user(user, session),
        "is_field_officer": await is_field_officer(user, session),
    }
