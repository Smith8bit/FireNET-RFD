from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.models import Region, User, UserRegion


async def user_region_paths(user: User, session: AsyncSession) -> list[str]:
    """Return the ltree paths the user is directly assigned to.
    Empty list = no access (non-superuser with no assignments)."""
    if user.is_superuser:
        return []
    result = await session.execute(
        select(Region.path)
        .join(UserRegion, UserRegion.region_id == Region.id)
        .where(UserRegion.user_id == user.id)
    )
    return [row[0] for row in result.all()]


async def fire_visible(user: User, fire_path: str, session: AsyncSession) -> bool:
    """True if any of the user's assigned regions is an ancestor of fire_path."""
    if user.is_superuser:
        return True
    result = await session.execute(
        text(
            """
            SELECT 1
            FROM user_regions ur
            JOIN regions r ON r.id = ur.region_id
            WHERE ur.user_id = :uid AND CAST(:fire_path AS ltree) <@ r.path
            LIMIT 1
            """
        ).bindparams(uid=user.id, fire_path=fire_path)
    )
    return result.first() is not None


def filter_fires(user_paths: list[str], fires: list[dict], superuser: bool) -> list[dict]:
    """In-memory equivalent of fire_visible for a list of fires.
    `fires` items must carry a `path` string (dot-separated ltree label)."""
    if superuser:
        return fires
    if not user_paths:
        return []
    prefixes = [p + "." for p in user_paths]
    exact = set(user_paths)
    out = []
    for fire in fires:
        p = fire.get("path", "")
        if p in exact or any(p.startswith(pref) for pref in prefixes):
            out.append(fire)
    return out