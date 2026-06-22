from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ..database.models import Region, User, UserRegion


async def user_roles(user: User, session: AsyncSession) -> list[str]:
    """All roles the user holds across their region assignments."""
    result = await session.execute(
        select(UserRegion.role).where(UserRegion.user_id == user.id)
    )
    return [row[0] for row in result.all()]


# --- Permission catalog -------------------------------------------------------
# Fine-grained, region-scoped console capabilities. A superuser implicitly holds
# all of them everywhere; everyone else holds an explicit subset per region
# assignment (user_regions.permissions). See the WS handlers for the gate each one
# guards.
VIEW_PERMS = frozenset(
    {"fires.view", "fires.history", "officers.view", "region_requests.view", "dispatchers.view"}
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

# Holding an action permission implies being able to read the resource it acts on.
# Region-change view/approve also imply officers.view, since a request is read and
# decided against the officer it concerns. expand() is one-level, so officers.view
# is listed directly on region_request.decide rather than chained via
# region_requests.view.
IMPLIES = {
    "officer.verify": frozenset({"officers.view"}),
    "officer.manage": frozenset({"officers.view"}),
    "fire.appoint": frozenset({"officers.view", "fires.view"}),
    "region_requests.view": frozenset({"officers.view"}),
    "region_request.decide": frozenset({"region_requests.view", "officers.view"}),
    "dispatcher.manage": frozenset({"dispatchers.view"}),
}

# Named bundles for provisioning — a starting checkbox set, never a gate.
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

# Permissions that authorize mutating officer/fire/dispatcher records.
MANAGE_PERMS = ACTION_PERMS - frozenset({"permission.grant"})

# Permissions a superuser may grant to others. dispatcher.manage and
# permission.grant are superuser-only (escalation guards) — never delegatable, so
# they're excluded and the backend rejects them on any grant payload.
GRANTABLE = ALL_PERMISSIONS - frozenset({"dispatcher.manage", "permission.grant"})


def expand(perms) -> set[str]:
    """Add implied view permissions. ponytail: one-level map, no transitive
    closure until a permission implies a permission that itself implies."""
    out = set(perms)
    for p in list(perms):
        out |= IMPLIES.get(p, frozenset())
    return out


def effective_perms(role: str, permissions) -> set[str]:
    """Permissions an assignment confers. A NULL set (row not yet backfilled with an
    explicit list) falls back to the role preset — role IS the migration. An explicit
    empty list is honored as 'no permissions', not re-expanded to the preset."""
    if permissions is None and role in PRESETS:
        permissions = PRESETS[role]
    return expand(set(permissions or []))


async def _assignments(user: User, session: AsyncSession):
    """(role, permissions) for every region the user is assigned to."""
    rows = await session.execute(
        select(UserRegion.role, UserRegion.permissions).where(UserRegion.user_id == user.id)
    )
    return rows.all()


async def has_perm(user: User, perm: str, path, session: AsyncSession) -> bool:
    """True if the user holds `perm` via an assignment whose region is an ancestor
    of (or equals) `path`. Superuser holds everything, everywhere."""
    if user.is_superuser:
        return True
    rows = await session.execute(
        text(
            "SELECT ur.role, ur.permissions FROM user_regions ur "
            "JOIN regions r ON r.id = ur.region_id "
            "WHERE ur.user_id = :uid AND CAST(:p AS ltree) <@ r.path"
        ).bindparams(uid=user.id, p=str(path))
    )
    return any(perm in effective_perms(role, permissions) for role, permissions in rows.all())


async def has_perm_anywhere(user: User, perm: str, session: AsyncSession) -> bool:
    """True if the user holds `perm` in any of their assignments (no path scope).
    For aggregate list views that span everything the user covers."""
    if user.is_superuser:
        return True
    return any(perm in effective_perms(role, p) for role, p in await _assignments(user, session))


async def user_permissions(user: User, session: AsyncSession) -> set[str]:
    """Union of effective permissions across all assignments. Superuser holds all."""
    if user.is_superuser:
        return set(ALL_PERMISSIONS)
    out: set[str] = set()
    for role, p in await _assignments(user, session):
        out |= effective_perms(role, p)
    return out


async def is_admin_user(user: User, session: AsyncSession) -> bool:
    """Web side (console access): superuser, or anyone holding at least one
    console permission. Field officers (no console perms) are rejected."""
    if user.is_superuser:
        return True
    return any(effective_perms(role, p) for role, p in await _assignments(user, session))


async def can_manage_officers(user: User, session: AsyncSession) -> bool:
    """Authority to mutate any officer/fire/dispatcher record (somewhere). Region
    scope is enforced separately per handler. Superuser always."""
    if user.is_superuser:
        return True
    return any(
        effective_perms(role, p) & MANAGE_PERMS for role, p in await _assignments(user, session)
    )


async def is_field_officer(user: User, session: AsyncSession) -> bool:
    """Mobile side: holds the field_officer role (set at registration, before verification)."""
    return "field_officer" in await user_roles(user, session)


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