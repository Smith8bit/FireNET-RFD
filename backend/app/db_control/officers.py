from typing import TypedDict

from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..config import get_settings
from ..database.models import Region, RegionChangeRequest, User, UserRegion
from ..database.schemas import UserRole
from .permission import user_region_paths

settings = get_settings()


class OfficerRow(TypedDict):
    """Typed contract for a verified, active field officer record returned to callers."""

    field_officer_id: str
    user_id: str
    name: str | None
    username: str
    division: str | None
    active: bool        # True only when heartbeat is within OFFICER_ONLINE_TTL_MINUTES
    fire_id: str | None
    last_updated: str | None
    location: dict[str, float] | None
    province_name_th: str
    province_path: str
    created_at: str | None


class PendingOfficerRow(TypedDict):
    """Typed contract for an unverified officer awaiting admin approval."""

    user_id: str
    username: str
    name: str | None
    division: str | None
    province_name_th: str
    province_path: str


class RegionRequestRow(TypedDict):
    """Typed contract for a pending province-change request."""

    request_id: str
    user_id: str
    officer_name: str | None
    username: str
    current_province: str
    requested_province: str
    created_at: str


# Raw SQL is used here because the ``active`` flag requires a server-side interval
# comparison (``make_interval``) and PostGIS functions (ST_X/ST_Y) that SQLAlchemy
# ORM would require significant boilerplate to express cleanly.
_PENDING_SQL = """
    SELECT u.id AS user_id, u.email AS username, ur.name AS name, u.division AS division,
           r.name_th AS province_name_th, r.path::text AS province_path
    FROM "user" u
    JOIN user_regions ur ON ur.user_id = u.id AND ur.role = 'field_officer'
    JOIN regions r ON r.id = ur.region_id
    WHERE u.is_verified = false
"""

_OFFICERS_SQL = """
    SELECT fo.id AS field_officer_id, fo.user_id, fo.name, u.email AS username, u.division AS division,
           (fo.active AND fo.last_updated > now() - make_interval(mins => :ttl)) AS active,
           fo.fire_id::text AS fire_id,
           fo.last_updated::text AS last_updated,
           ST_Y(fo.last_location::geometry) AS latitude,
           ST_X(fo.last_location::geometry) AS longitude,
           ur.created_at AS created_at,
           r.name_th AS province_name_th, r.path::text AS province_path
    FROM field_officers fo
    JOIN "user" u ON u.id = fo.user_id
    JOIN user_regions ur ON ur.user_id = fo.user_id AND ur.role = 'field_officer'
    JOIN regions r ON r.id = ur.region_id
    WHERE u.is_verified = true
"""

# Kept as a separate fragment so it can be appended after either the superuser or
# region-scoped WHERE clause without duplication.
_OFFICERS_ORDER_CAP = " ORDER BY fo.last_updated DESC NULLS LAST LIMIT :cap"


async def fetch_officers(
    session: AsyncSession, user: User, *, limit: int | None = None
) -> list[OfficerRow]:
    """Return verified field officers visible to ``user``.

    Superusers see all officers. Others are restricted to officers whose region
    is a descendant of any of their assigned region paths (ltree ``<@`` array op).

    Args:
        session: Active async SQLAlchemy session.
        user:    Requesting user determining the visibility scope.
        limit:   Override the default ``OFFICER_MAP_MAX`` cap from settings.

    Returns:
        List of ``OfficerRow`` dicts ordered by most-recently-updated first.
        ``location`` is ``None`` if the officer has never reported a GPS fix.
    """
    ttl = settings.OFFICER_ONLINE_TTL_MINUTES
    cap = limit if limit is not None else settings.OFFICER_MAP_MAX
    if user.is_superuser:
        rows = await session.execute(
            text(_OFFICERS_SQL + _OFFICERS_ORDER_CAP).bindparams(ttl=ttl, cap=cap)
        )
    else:
        paths = await user_region_paths(user, session)
        if not paths:
            return []
        rows = await session.execute(
            text(
                _OFFICERS_SQL
                # CAST to ltree[] enables the native <@ ANY(array) index scan
                + " AND r.path <@ ANY(CAST(:paths AS ltree[]))"
                + _OFFICERS_ORDER_CAP
            ).bindparams(paths=paths, ttl=ttl, cap=cap)
        )
    return [
        {
            "field_officer_id": str(m["field_officer_id"]),
            "user_id": str(m["user_id"]),
            "name": m["name"],
            "username": m["username"],
            "division": m["division"],
            "active": m["active"],
            "fire_id": m["fire_id"],
            "last_updated": m["last_updated"],
            "location": (
                {"latitude": m["latitude"], "longitude": m["longitude"]}
                if m["latitude"] is not None
                else None
            ),
            "province_name_th": m["province_name_th"],
            "province_path": m["province_path"],
            "created_at": m["created_at"].isoformat() if m["created_at"] else None,
        }
        for m in rows.mappings().all()
    ]


async def fetch_pending(session: AsyncSession, user: User) -> list[PendingOfficerRow]:
    """Return officers registered but not yet verified by an admin.

    Args:
        session: Active async SQLAlchemy session.
        user:    Requesting user; non-superusers only see pending officers in their regions.

    Returns:
        List of ``PendingOfficerRow`` dicts ordered by email.
    """
    if user.is_superuser:
        rows = await session.execute(text(_PENDING_SQL + " ORDER BY u.email"))
    else:
        paths = await user_region_paths(user, session)
        if not paths:
            return []
        rows = await session.execute(
            text(
                _PENDING_SQL
                + " AND r.path <@ ANY(CAST(:paths AS ltree[])) ORDER BY u.email"
            ).bindparams(paths=paths)
        )
    return [
        {
            "user_id": str(m["user_id"]),
            "username": m["username"],
            "name": m["name"],
            "division": m["division"],
            "province_name_th": m["province_name_th"],
            "province_path": m["province_path"],
        }
        for m in rows.mappings().all()
    ]


async def fetch_region_requests(
    session: AsyncSession, user: User
) -> list[RegionRequestRow]:
    """Return pending province-change requests visible to ``user``.

    Two Region aliases are required because each request references both the
    officer's current province and the requested (destination) province.
    Non-superusers only see requests where the *destination* falls inside their
    region subtree, since they are the approving authority for that province.

    Args:
        session: Active async SQLAlchemy session.
        user:    Requesting user determining the visibility scope.

    Returns:
        List of ``RegionRequestRow`` dicts ordered by request date ascending.
    """
    dest = aliased(Region)  # requested (destination) province
    cur = aliased(Region)   # officer's current province
    stmt = (
        select(
            RegionChangeRequest.id,
            RegionChangeRequest.user_id,
            RegionChangeRequest.created_at,
            UserRegion.name.label("officer_name"),
            User.email.label("username"),
            cur.name_th.label("current_province"),
            dest.name_th.label("requested_province"),
        )
        .join(dest, dest.id == RegionChangeRequest.requested_region_id)
        .join(User, User.id == RegionChangeRequest.user_id)
        .join(
            UserRegion,
            (UserRegion.user_id == RegionChangeRequest.user_id)
            & (UserRegion.role == UserRole.FIELD_OFFICER),
        )
        .join(cur, cur.id == UserRegion.region_id)
        .where(RegionChangeRequest.status == "pending")
        .order_by(RegionChangeRequest.created_at)
    )
    if not user.is_superuser:
        paths = await user_region_paths(user, session)
        if not paths:
            return []
        # Filter on the destination region so approvers only see requests they can act on.
        stmt = stmt.where(or_(*[dest.path.op("<@")(p) for p in paths]))
    rows = (await session.execute(stmt)).all()
    return [
        {
            "request_id": str(r.id),
            "user_id": str(r.user_id),
            "officer_name": r.officer_name,
            "username": r.username,
            "current_province": r.current_province,
            "requested_province": r.requested_province,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]
