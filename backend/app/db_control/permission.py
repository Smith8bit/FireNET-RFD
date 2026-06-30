from typing import Any
from uuid import UUID

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.models import Region, User, UserRegion


async def user_roles(user: User, session: AsyncSession) -> list[str]:
    result = await session.execute(
        select(UserRegion.role).where(UserRegion.user_id == user.id)
    )
    return [row[0] for row in result.all()]


VIEW_PERMS = frozenset(
    {
        "fires.view",
        "fires.history",
        "officers.view",
        "region_requests.view",
        "dispatchers.view",
    }
)
ACTION_PERMS = frozenset(
    {
        "officer.verify",
        "officer.manage",
        "fire.appoint",
        "region_request.decide",
        "dispatcher.manage",
        "permission.grant",
    }
)
ALL_PERMISSIONS = VIEW_PERMS | ACTION_PERMS

IMPLIES = {
    "officer.verify": frozenset({"officers.view"}),
    "officer.manage": frozenset({"officers.view"}),
    "fire.appoint": frozenset({"officers.view", "fires.view"}),
    "region_requests.view": frozenset({"officers.view"}),
    "region_request.decide": frozenset({"region_requests.view", "officers.view"}),
    "dispatcher.manage": frozenset({"dispatchers.view"}),
}

PRESETS = {
    "viewer": frozenset({"fires.view", "officers.view"}),
    "dispatcher": frozenset(
        {
            "fires.view",
            "officers.view",
            "region_requests.view",
            "officer.verify",
            "officer.manage",
            "fire.appoint",
            "region_request.decide",
        }
    ),
    "admin": ALL_PERMISSIONS,
}

ROLE_FLOOR = {"dispatcher": frozenset({"fires.view"})}

MANAGE_PERMS = ACTION_PERMS - frozenset({"permission.grant"})

GRANTABLE = ALL_PERMISSIONS - frozenset({"dispatcher.manage", "permission.grant"})


def expand(perms) -> set[str]:
    out = set(perms)
    for p in list(perms):
        out |= IMPLIES.get(p, frozenset())
    return out


def effective_perms(role: str, permissions) -> set[str]:
    if permissions is None and role in PRESETS:
        permissions = PRESETS[role]
    return expand(set(permissions or [])) | ROLE_FLOOR.get(role, frozenset())


async def _assignments(user: User, session: AsyncSession):
    rows = await session.execute(
        select(UserRegion.role, UserRegion.permissions).where(
            UserRegion.user_id == user.id
        )
    )
    return rows.all()


async def has_perm(user: User, perm: str, path, session: AsyncSession) -> bool:
    if user.is_superuser:
        return True
    rows = await session.execute(
        text(
            "SELECT ur.role, ur.permissions FROM user_regions ur "
            "JOIN regions r ON r.id = ur.region_id "
            "WHERE ur.user_id = :uid AND CAST(:p AS ltree) <@ r.path"
        ).bindparams(uid=user.id, p=str(path))
    )
    return any(
        perm in effective_perms(role, permissions) for role, permissions in rows.all()
    )


async def has_perm_anywhere(user: User, perm: str, session: AsyncSession) -> bool:
    if user.is_superuser:
        return True
    return any(
        perm in effective_perms(role, p)
        for role, p in await _assignments(user, session)
    )


async def user_permissions(user: User, session: AsyncSession) -> set[str]:
    if user.is_superuser:
        return set(ALL_PERMISSIONS)
    out: set[str] = set()
    for role, p in await _assignments(user, session):
        out |= effective_perms(role, p)
    return out


async def is_admin_user(user: User, session: AsyncSession) -> bool:
    if user.is_superuser:
        return True
    return any(
        effective_perms(role, p) for role, p in await _assignments(user, session)
    )


async def can_manage_officers(user: User, session: AsyncSession) -> bool:
    if user.is_superuser:
        return True
    return any(
        effective_perms(role, p) & MANAGE_PERMS
        for role, p in await _assignments(user, session)
    )


async def is_field_officer(user: User, session: AsyncSession) -> bool:
    return "field_officer" in await user_roles(user, session)


async def user_region_paths(user: User, session: AsyncSession) -> list[str]:
    if user.is_superuser:
        return []
    result = await session.execute(
        select(Region.path)
        .join(UserRegion, UserRegion.region_id == Region.id)
        .where(UserRegion.user_id == user.id)
    )
    return [row[0] for row in result.all()]


async def fire_visible(user: User, fire_path: str, session: AsyncSession) -> bool:
    if user.is_superuser:
        return True
    result = await session.execute(text("""
            SELECT 1
            FROM user_regions ur
            JOIN regions r ON r.id = ur.region_id
            WHERE ur.user_id = :uid AND CAST(:fire_path AS ltree) <@ r.path
            LIMIT 1
            """).bindparams(uid=user.id, fire_path=fire_path))
    return result.first() is not None


def filter_fires(
    user_paths: list[str], fires: list[dict], superuser: bool
) -> list[dict]:
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


async def update_user_region(
    session: AsyncSession,
    *,
    user_id: UUID,
    old_region_id: UUID,
    ur_obj: UserRegion,
    **values: Any,
) -> None:
    session.expunge(ur_obj)
    await session.execute(
        update(UserRegion)
        .where(UserRegion.user_id == user_id, UserRegion.region_id == old_region_id)
        .values(**values)
    )


if __name__ == "__main__":
    assert effective_perms("dispatcher", []) == {"fires.view"}
    assert "fires.view" in effective_perms("dispatcher", None)
    assert "fires.view" in effective_perms("dispatcher", ["officers.view"])
    assert effective_perms("viewer", []) == set()
    assert not (effective_perms("dispatcher", []) & MANAGE_PERMS)
    print("permission self-check ok")
