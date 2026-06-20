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

_DISPATCHER_PERMS = sorted(PRESETS["dispatcher"])
_ADMIN_PERMS = sorted(PRESETS["admin"])

FIXTURE = Path(__file__).parent / "seedbag" / "regions_info.json"

# Generated regional/province credentials are written here once (repo root), then
# the file is gitignored. seed.py -> database -> app -> backend -> firenet/
_ACCOUNTS_CSV = Path(__file__).resolve().parents[3] / "seeded_accounts.csv"


def _username_from(value: str) -> str:
    """Username from a code or name: lowercased, letters+digits only (drops
    spaces and any special characters so it always passes username validation)."""
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _new_password() -> str:
    """A strong, random per-account password (URL-safe, ~16 chars)."""
    return secrets.token_urlsafe(12)


def _write_accounts_csv(accounts: list[dict]) -> None:
    """Record freshly generated credentials to the gitignored repo-root CSV.

    Only newly created accounts are written — existing accounts keep their
    already-hashed (unrecoverable) passwords, so a re-run with nothing new to
    create leaves any previous CSV untouched rather than clobbering it."""
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
    existing = (
        await session.execute(select(Region).where(Region.level == "province").limit(1))
    ).scalar_one_or_none()
    if existing is not None:
        return

    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    nat = data["national"]

    regional_rows = (
        await session.execute(select(Region).where(Region.level == "regional"))
    ).scalars().all()
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
            result = await session.execute(select(User).where(User.email == settings.INITIAL_SUPERUSER_USERNAME))
            user = result.scalar_one()

        national = (
            await session.execute(select(Region).where(Region.level == "national"))
        ).scalar_one_or_none()
        if national is None:
            print("[seed] national region not found, skipping superuser region assignment")
            return

        existing = await session.get(UserRegion, (user.id, national.id))
        if not existing:
            session.add(UserRegion(user_id=user.id, region_id=national.id, role="admin",
                                   name="Admin", permissions=_ADMIN_PERMS))
            await session.commit()
            print(f"[seed] assigned superuser → national region ({national.name_en})")


async def seed_regional_users() -> list[dict]:
    """Provision one real dispatcher account per regional office.
    Username: {code without special chars}, random password.
    Returns the newly created accounts (with plaintext passwords) for the CSV."""
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    created: list[dict] = []
    async with async_session_maker() as session:
        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)
        for ro in data["regional"]:
            username = _username_from(ro['code'])
            password = _new_password()
            try:
                user = await manager.create(
                    UserCreate(email=username, password=password, is_superuser=False, is_verified=True),
                    safe=False,
                )
                created.append({"username": username, "password": password, "role": "dispatcher",
                                "scope": ro["code"], "name": ro["name_en"]})
                print(f"[seed] created regional user {username}")
            except UserAlreadyExists:
                result = await session.execute(select(User).where(User.email == username))
                user = result.scalar_one()

            region = (
                await session.execute(select(Region).where(Region.code == ro["code"]))
            ).scalar_one_or_none()
            if region is None:
                print(f"[seed] region {ro['code']} not found, skipping assignment")
                continue

            existing = await session.get(UserRegion, (user.id, region.id))
            if not existing:
                session.add(UserRegion(user_id=user.id, region_id=region.id, role="dispatcher",
                                       name=ro["name_en"], permissions=_DISPATCHER_PERMS))
                await session.commit()
                print(f"[seed] assigned {username} → {ro['code']}")
    return created


async def seed_province_users() -> list[dict]:
    """Provision one real dispatcher account per province.
    Username: {name_en without spaces/special chars}, random password.
    Returns the newly created accounts (with plaintext passwords) for the CSV."""
    created: list[dict] = []
    async with async_session_maker() as session:
        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)

        province_regions = (
            await session.execute(select(Region).where(Region.level == "province"))
        ).scalars().all()

        settings = get_settings()
        for region in province_regions:
            username = _username_from(region.name_en)
            password = _new_password()

            try:
                user = await manager.create(
                    UserCreate(email=username, password=password, is_superuser=False, is_verified=True),
                    safe=False,
                )
                created.append({"username": username, "password": password, "role": "dispatcher",
                                "scope": region.code, "name": region.name_en})
                print(f"[seed] created province user {username}")
            except UserAlreadyExists:
                result = await session.execute(select(User).where(User.email == username))
                user = result.scalar_one()

            existing = await session.get(UserRegion, (user.id, region.id))
            if not existing:
                session.add(UserRegion(user_id=user.id, region_id=region.id, role="dispatcher",
                                       name=region.name_en, permissions=_DISPATCHER_PERMS))
                await session.commit()
                print(f"[seed] assigned {username} → {region.code}")
    return created


async def run_all() -> None:
    async with async_session_maker() as session:
        await seed_regions(session)
        await seed_provinces(session)
    await seed_superuser()
    # Provision one real dispatcher account per regional office and per province
    # (random passwords). The generated credentials are written once to a
    # gitignored CSV at the repo root — distribute and rotate them, then disable
    # the flag. Off by default so it never runs unintentionally.
    if get_settings().SEED_REGIONAL_ACCOUNTS:
        created = await seed_regional_users()
        created += await seed_province_users()
        _write_accounts_csv(created)
    else:
        print("[seed] SEED_REGIONAL_ACCOUNTS is off; skipping regional/province provisioning")


if __name__ == "__main__":
    import asyncio
    asyncio.run(run_all())