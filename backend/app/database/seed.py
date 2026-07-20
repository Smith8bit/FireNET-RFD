import csv
import json
import re
import secrets
from pathlib import Path

from fastapi_users.exceptions import UserAlreadyExists
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

from ..config import get_settings
from .db import async_session_maker
from .models import Region, User, UserRegion
from .schemas import UserCreate
from ..db_control.permission import PRESETS
from ..db_control.users import UserManager

# Sorted for deterministic storage in the PostgreSQL TEXT[] column.
_DISPATCHER_PERMS = sorted(PRESETS["dispatcher"])
_ADMIN_PERMS = sorted(PRESETS["admin"])

# Resolved relative to this file so the path is correct regardless of CWD at startup.
FIXTURE = Path(__file__).parent / "seedbag" / "regions_info.json"

# Written three directories above the app package (project root) so it's
# accessible post-deploy without exposing it inside the importable package tree.
_ACCOUNTS_CSV = Path(__file__).resolve().parents[3] / "seeded_accounts.csv"


def _username_from(value: str) -> str:
    """Derive a safe login handle by stripping all non-alphanumeric characters."""
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _new_password() -> str:
    """Return a cryptographically random URL-safe password (~16 chars entropy)."""
    return secrets.token_urlsafe(12)


def _write_accounts_csv(accounts: list[dict]) -> None:
    """
    Persist seeded credentials to a CSV at the project root.

    Args:
        accounts: List of dicts with keys username, password, role, scope, name.
                  Only newly created accounts are included; existing ones are skipped.
    """
    if not accounts:
        print("[seed] no new accounts created; credentials CSV left unchanged")
        return
    fields = ["username", "password", "role", "scope", "name"]
    with _ACCOUNTS_CSV.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        for acc in accounts:
            writer.writerow({k: acc.get(k, "") for k in fields})
    print(f"[seed] wrote {len(accounts)} account credentials to {_ACCOUNTS_CSV}")


async def seed_regions(session: AsyncSession) -> None:
    """
    Insert the national and regional hierarchy from the fixture JSON.

    Idempotent: returns immediately if any Region row already exists,
    so restarts or re-deployments won't produce duplicate hierarchy nodes.

    Args:
        session: An open AsyncSession; the caller owns the transaction boundary.
    """
    existing = (await session.execute(select(Region).limit(1))).scalar_one_or_none()
    if existing is not None:
        return
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    nat = data["national"]
    national = Region(
        code=nat["code"],
        name_th=nat["name_th"],
        name_en=nat["name_en"],
        level="national",
        path=nat["slug"],
        parent_id=None,
    )
    session.add(national)
    print(f"[seed] added national region {nat['name_en']}")
    # flush (not commit) to obtain national.id for child FK references
    # while keeping the transaction open for the regional batch.
    await session.flush()

    for ro in data["regional"]:
        session.add(
            Region(
                code=ro["code"],
                name_th=ro["name_th"],
                name_en=ro["name_en"],
                level="regional",
                path=f"{nat['slug']}.{ro['slug']}",
                parent_id=national.id,
            )
        )
        print(f"[seed] added regional region {ro['name_en']}")
    await session.commit()


async def seed_provinces(session: AsyncSession) -> None:
    """
    Insert province-level Region rows linked to their regional parents.

    Idempotent: skips entirely if any province row already exists.
    Assumes seed_regions has already committed, because it reads regional
    rows to resolve parent_id FKs without issuing N+1 queries.

    Args:
        session: An open AsyncSession; the caller owns the transaction boundary.
    """
    existing = (
        await session.execute(select(Region).where(Region.level == "province").limit(1))
    ).scalar_one_or_none()
    if existing is not None:
        return
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    nat = data["national"]

    regional_rows = (
        (await session.execute(select(Region).where(Region.level == "regional")))
        .scalars()
        .all()
    )
    # Build an in-memory lookup to avoid one SELECT per province when resolving parent_id.
    regional_slug_to_id = {ro.path.split(".")[-1]: ro.id for ro in regional_rows}

    for pv in data["province"]:
        parent_id = regional_slug_to_id.get(pv["parent_slug"])
        session.add(
            Region(
                code=pv["code"],
                name_th=pv["name_th"],
                name_en=pv["name_en"],
                level="province",
                path=f"{nat['slug']}.{pv['parent_slug']}.{pv['slug']}",
                parent_id=parent_id,
            )
        )
    await session.commit()


async def seed_superuser() -> None:
    """
    Create the initial superuser account and assign it to the national region.

    Idempotent: if the account already exists, only the UserRegion assignment
    is checked; the password is never changed on subsequent runs.
    safe=False bypasses the is_verified guard — correct here since this is a
    controlled internal seed, not a user self-registration path.
    """
    settings = get_settings()
    nat_name = json.loads(FIXTURE.read_text(encoding="utf-8"))["national"]["name_en"]
    async with async_session_maker() as session:
        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)
        try:
            user = await manager.create(
                UserCreate(
                    email=settings.INITIAL_SUPERUSER_USERNAME,
                    password=settings.INITIAL_SUPERUSER_PASSWORD,
                    is_superuser=True,
                    is_verified=True,
                    division="กรมป่าไม้",
                ),
                safe=False,
            )
            print(f"[seed] created superuser {settings.INITIAL_SUPERUSER_USERNAME}")
        except UserAlreadyExists:
            # Re-fetch so we still have the user object for the region assignment below.
            result = await session.execute(
                select(User).where(User.email == settings.INITIAL_SUPERUSER_USERNAME)
            )
            user = result.scalar_one()
        national = (
            await session.execute(select(Region).where(Region.level == "national"))
        ).scalar_one_or_none()
        if national is None:
            print(
                "[seed] national region not found, skipping superuser region assignment"
            )
            return
        existing = await session.get(UserRegion, (user.id, national.id))
        if not existing:
            session.add(
                UserRegion(
                    user_id=user.id,
                    region_id=national.id,
                    role="admin",
                    name="Admin",
                    permissions=_ADMIN_PERMS,
                )
            )
            await session.commit()
            print(f"[seed] assigned superuser -> national region ({national.name_en})")


async def seed_regional_users() -> list[dict]:
    """
    Create one dispatcher account per regional zone and bind it to that zone.

    Returns:
        List of dicts for newly created accounts only (skips pre-existing ones).
        Each dict contains: username, password, role, scope, name.
    """
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    created: list[dict] = []
    async with async_session_maker() as session:
        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)
        for ro in data["regional"]:
            username = _username_from(ro["code"])
            password = _new_password()
            try:
                user = await manager.create(
                    UserCreate(
                        email=username,
                        password=password,
                        is_superuser=False,
                        is_verified=True,
                    ),
                    safe=False,
                )
                created.append(
                    {
                        "username": username,
                        "password": password,
                        "role": "dispatcher",
                        "scope": ro["code"],
                        "name": ro["name_en"],
                    }
                )
                print(f"[seed] created regional user {username}")
            except UserAlreadyExists:
                result = await session.execute(
                    select(User).where(User.email == username)
                )
                user = result.scalar_one()
            region = (
                await session.execute(select(Region).where(Region.code == ro["code"]))
            ).scalar_one_or_none()
            if region is None:
                print(f"[seed] region {ro['code']} not found, skipping assignment")
                continue
            existing = await session.get(UserRegion, (user.id, region.id))
            if not existing:
                session.add(
                    UserRegion(
                        user_id=user.id,
                        region_id=region.id,
                        role="dispatcher",
                        name=ro["name_en"],
                        permissions=_DISPATCHER_PERMS,
                    )
                )
                await session.commit()
                print(f"[seed] assigned {username} -> {ro['code']}")
    return created


async def seed_province_users() -> list[dict]:
    """
    Create one dispatcher account per province and bind it to that province region.

    Returns:
        List of dicts for newly created accounts only (skips pre-existing ones).
        Each dict contains: username, password, role, scope, name.
    """
    created: list[dict] = []
    async with async_session_maker() as session:
        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)

        province_regions = (
            (await session.execute(select(Region).where(Region.level == "province")))
            .scalars()
            .all()
        )

        settings = get_settings()
        for region in province_regions:
            username = _username_from(region.name_en)
            password = _new_password()

            try:
                user = await manager.create(
                    UserCreate(
                        email=username,
                        password=password,
                        is_superuser=False,
                        is_verified=True,
                    ),
                    safe=False,
                )
                created.append(
                    {
                        "username": username,
                        "password": password,
                        "role": "dispatcher",
                        "scope": region.code,
                        "name": region.name_en,
                    }
                )
                print(f"[seed] created province user {username}")
            except UserAlreadyExists:
                result = await session.execute(
                    select(User).where(User.email == username)
                )
                user = result.scalar_one()
            existing = await session.get(UserRegion, (user.id, region.id))
            if not existing:
                session.add(
                    UserRegion(
                        user_id=user.id,
                        region_id=region.id,
                        role="dispatcher",
                        name=region.name_en,
                        permissions=_DISPATCHER_PERMS,
                    )
                )
                await session.commit()
                print(f"[seed] assigned {username} -> {region.code}")
    return created


async def run_all() -> None:
    """
    Entry point for the full seed pipeline.

    Runs in order: regions -> provinces -> superuser -> (optional) regional/province accounts.
    SEED_REGIONAL_ACCOUNTS can be disabled in production to skip auto-provisioning
    dispatcher accounts when those are managed externally.
    """
    async with async_session_maker() as session:
        await seed_regions(session)
        await seed_provinces(session)
    await seed_superuser()
    if get_settings().SEED_REGIONAL_ACCOUNTS:
        created = await seed_regional_users()
        created += await seed_province_users()
        _write_accounts_csv(created)
    else:
        print(
            "[seed] SEED_REGIONAL_ACCOUNTS is off; skipping regional/province provisioning"
        )


if __name__ == "__main__":
    import asyncio

    asyncio.run(run_all())
