import json
from pathlib import Path

from fastapi_users.exceptions import UserAlreadyExists
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase

from ..config import get_settings
from .db import async_session_maker
from .models import Region, User
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


async def run_all() -> None:
    async with async_session_maker() as session:
        await seed_regions(session)
    await seed_superuser()