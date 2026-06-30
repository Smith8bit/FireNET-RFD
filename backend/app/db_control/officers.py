"""Officer-specific query layer: shared between HTTP routers and WS handlers."""

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
    field_officer_id: str
    user_id: str
    name: str | None
    username: str
    division: str | None
    active: bool
    fire_id: str | None
    last_updated: str | None
    location: dict[str, float] | None
    province_name_th: str
    province_path: str
    created_at: str | None


class PendingOfficerRow(TypedDict):
    user_id: str
    username: str
    name: str | None
    division: str | None
    province_name_th: str
    province_path: str


class RegionRequestRow(TypedDict):
    request_id: str
    user_id: str
    officer_name: str | None
    username: str
    current_province: str
    requested_province: str
    created_at: str


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

# A national/large-region admin must never be handed the whole fleet: cap every
# officer fetch at OFFICER_MAP_MAX, keeping the freshest (most recently active) rows.
_OFFICERS_ORDER_CAP = " ORDER BY fo.last_updated DESC NULLS LAST LIMIT :cap"


async def fetch_officers(
    session: AsyncSession, user: User, *, limit: int | None = None
) -> list[OfficerRow]:
    """Verified officers scoped to the user's region, capped at OFFICER_MAP_MAX."""
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
            "location": {"latitude": m["latitude"], "longitude": m["longitude"]}
            if m["latitude"] is not None
            else None,
            "province_name_th": m["province_name_th"],
            "province_path": m["province_path"],
            "created_at": m["created_at"].isoformat() if m["created_at"] else None,
        }
        for m in rows.mappings().all()
    ]


async def fetch_pending(session: AsyncSession, user: User) -> list[PendingOfficerRow]:
    """Unverified officers scoped to the user's region."""
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
    """Pending officer region-change requests scoped to the admin's destination province."""
    dest = aliased(Region)
    cur = aliased(Region)
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
