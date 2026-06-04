import json
from pathlib import Path

from fastapi_users.exceptions import UserAlreadyExists
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

from ..config import get_settings
from .db import async_session_maker
from .models import Region, User, UserRegion
from .schemas import UserCreate
from ..db_control.users import UserManager

FIXTURE = Path(__file__).parent / "seedbag" / "regions_info.json"


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
    async with async_session_maker() as session:
        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)
        try:
            await manager.create(
                UserCreate(
                    email=settings.INITIAL_SUPERUSER_EMAIL,
                    password=settings.INITIAL_SUPERUSER_PASSWORD,
                    is_superuser=True,
                    is_verified=True,
                ),
                safe=False,
            )
            print(f"[seed] created superuser {settings.INITIAL_SUPERUSER_EMAIL}")
        except UserAlreadyExists:
            pass


async def seed_regional_users() -> None:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    regional_specs = [
        {
            "email": f"{ro['code'].replace('-', '')}@forest.com",
            "password": "1234",
            "region_code": ro["code"],
        }
        for ro in data["regional"]
    ]

    async with async_session_maker() as session:
        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)
        for spec in regional_specs:
            try:
                user = await manager.create(
                    UserCreate(
                        email=spec["email"],
                        password=spec["password"],
                        is_superuser=False,
                        is_verified=True,
                    ),
                    safe=False,
                )
                print(f"[seed] created regional user {spec['email']}")
            except UserAlreadyExists:
                result = await session.execute(select(User).where(User.email == spec["email"]))
                user = result.scalar_one()

            region = (
                await session.execute(select(Region).where(Region.code == spec["region_code"]))
            ).scalar_one_or_none()
            if region is None:
                print(f"[seed] region {spec['region_code']} not found, skipping assignment")
                continue

            existing = await session.get(UserRegion, (user.id, region.id))
            if not existing:
                session.add(UserRegion(user_id=user.id, region_id=region.id, role="viewer"))
                await session.commit()
                print(f"[seed] assigned {spec['email']} → {spec['region_code']}")


async def seed_province_users() -> None:
    async with async_session_maker() as session:
        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)

        province_regions = (
            await session.execute(select(Region).where(Region.level == "province"))
        ).scalars().all()

        for region in province_regions:
            username = region.name_en.lower().replace(" ", "_")
            email = f"{username}@province.com"
            password = region.name_en

            try:
                user = await manager.create(
                    UserCreate(
                        email=email,
                        password=password,
                        is_superuser=False,
                        is_verified=True,
                    ),
                    safe=False,
                )
                print(f"[seed] created province user {email}")
            except UserAlreadyExists:
                result = await session.execute(select(User).where(User.email == email))
                user = result.scalar_one()

            existing = await session.get(UserRegion, (user.id, region.id))
            if not existing:
                session.add(UserRegion(user_id=user.id, region_id=region.id, role="viewer"))
                await session.commit()
                print(f"[seed] assigned {email} → {region.code}")


async def run_all() -> None:
    async with async_session_maker() as session:
        await seed_regions(session)
        await seed_provinces(session)
    await seed_superuser()
    await seed_regional_users()
    await seed_province_users()


if __name__ == "__main__":
    import asyncio
    asyncio.run(run_all())