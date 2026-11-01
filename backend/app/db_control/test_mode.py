"""Test mode: an admin-only, system-wide drill on replayed copies of past fires.

While Test mode is on, the fire-drill code paths (fire lists, booking, resolution,
appointments, false alarms, officer map) open their sessions through `mode_session` /
`get_mode_session`. Those sessions resolve the mirrored tables (`TEST_TABLES`) to the
`test` schema (see database/db.py), so the existing logic runs unchanged against test
data. Everything else — ingest, expiry, user/officer administration, auth, settings —
keeps the plain session and production tables, so nothing done in a drill can touch a
real row, and production pays nothing extra while Test mode is off.

The on/off flag lives in app_settings and is cached in memory (`test_mode_on()` costs
no query). A change NOTIFYs `MODE_NOTIFY_TAG`; ws/pg_listener.py reloads the flag on
every API replica and pushes the switch to connected clients.
"""

import json
import logging
import uuid
from datetime import date, datetime, timezone
from typing import Any, AsyncGenerator

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from .. import storage
from ..config import get_settings
from ..database import async_session_maker
from ..database.db import TEST_SCHEMA
from ..database.models import AppSetting, User
from .audit import audit
from .push import send_push

logger = logging.getLogger("firenet.test_mode")
settings = get_settings()

_KEY = "test_mode"
# Payload sent on pg_listener.CHANNEL ('firenet_changes') when the mode flips.
MODE_NOTIFY_TAG = "test_mode"
# Object-storage prefix for drill evidence, so "clear test data" can wipe it by prefix.
EVIDENCE_PREFIX = f"{TEST_SCHEMA}/"

# Tables a drill writes to. Each gets a structural copy in the test schema; every
# other table (user, regions, user_regions, tokens, app_settings) stays shared.
TEST_TABLES = (
    "firespots",
    "field_officers",
    "fire_resolutions",
    "fire_resolution_images",
    "audit_log",
)

_state: dict[str, Any] = {"enabled": False, "since": None, "by": None}


class TestModeConflict(Exception):
    """Raised when an action needs the opposite mode (e.g. replay while off)."""


# --------------------------------------------------------------------------- state


def test_mode_on() -> bool:
    """Cached on/off flag; never queries the DB."""
    return bool(_state["enabled"])


def test_mode_state() -> dict[str, Any]:
    """Public view of the mode: ``{"enabled", "since", "by"}``."""
    return dict(_state)


def _apply(raw: str | dict | None) -> None:
    """Load a stored app_settings value (JSON text or dict) into the cache."""
    value: dict = {}
    if isinstance(raw, dict):
        value = raw
    elif raw:
        try:
            value = json.loads(raw)
        except ValueError:
            logger.warning("ignoring malformed test_mode setting: %r", raw)
    enabled = bool(value.get("enabled")) and settings.TEST_MODE_ALLOWED
    _state.update(
        enabled=enabled,
        since=value.get("since") if enabled else None,
        by=value.get("by") if enabled else None,
    )


async def reload() -> dict[str, Any]:
    """Refresh the cached flag from app_settings; called at boot and on NOTIFY."""
    if not settings.TEST_MODE_ALLOWED:
        _apply(None)
        return test_mode_state()
    async with async_session_maker() as session:
        raw = (
            await session.execute(
                select(AppSetting.value).where(AppSetting.key == _KEY)
            )
        ).scalar_one_or_none()
    _apply(raw)
    return test_mode_state()


# ------------------------------------------------------------------------ sessions


def mode_session(test: bool | None = None) -> AsyncSession:
    """Open a session routed by mode: test schema when ``test`` (default: current mode).

    Returns a plain production session whenever Test mode is off (``test_mode_on()``
    is already false when not allowed), so callers can use this unconditionally on the
    drill code paths.
    """
    if test is None:
        test = test_mode_on()
    return async_session_maker(info={"test": bool(test)})


def is_test_session(session: AsyncSession) -> bool:
    return bool(session.info.get("test"))


def evidence_prefix(session: AsyncSession) -> str:
    """Storage key prefix for evidence written through ``session``."""
    return EVIDENCE_PREFIX if is_test_session(session) else ""


async def get_mode_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency: get_async_session's twin that follows the current mode."""
    async with mode_session() as session:
        yield session



# ----------------------------------------------------------------- schema bootstrap

# Adds any column present in public.<t> but missing from test.<t> (copying type,
# default and NOT NULL), so later ALTERs of a production table can't break Test mode.
_SYNC_COLUMNS_SQL = """
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT pc.relname AS tbl, pa.attname AS col,
               format_type(pa.atttypid, pa.atttypmod) AS typ,
               pg_get_expr(pd.adbin, pd.adrelid) AS def,
               pa.attnotnull AS notnull
        FROM pg_attribute pa
        JOIN pg_class pc ON pc.oid = pa.attrelid
        JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
        LEFT JOIN pg_attrdef pd ON pd.adrelid = pa.attrelid AND pd.adnum = pa.attnum
        WHERE pc.relname = ANY(ARRAY[{tables}])
          AND pa.attnum > 0 AND NOT pa.attisdropped
          AND NOT EXISTS (
              SELECT 1 FROM pg_attribute ta
              JOIN pg_class tc ON tc.oid = ta.attrelid
              JOIN pg_namespace tn ON tn.oid = tc.relnamespace AND tn.nspname = '{schema}'
              WHERE tc.relname = pc.relname AND ta.attname = pa.attname
                AND ta.attnum > 0 AND NOT ta.attisdropped
          )
    LOOP
        EXECUTE format(
            'ALTER TABLE {schema}.%I ADD COLUMN %I %s%s%s',
            r.tbl, r.col, r.typ,
            CASE WHEN r.def IS NOT NULL THEN ' DEFAULT ' || r.def ELSE '' END,
            CASE WHEN r.notnull AND r.def IS NOT NULL THEN ' NOT NULL' ELSE '' END
        );
    END LOOP;
END $$;
""".format(
    tables=", ".join(f"'{t}'" for t in TEST_TABLES), schema=TEST_SCHEMA
)

# LIKE copies columns, defaults, CHECKs and indexes but not foreign keys. Only
# test-to-test FKs are added (for the cascades the drill code relies on); none point
# at a public table, which would hang RI triggers on production tables.
_TEST_FKS = (
    ("test_fr_fire_fk", "fire_resolutions", "fire_id", "firespots", "CASCADE"),
    ("test_fri_resolution_fk", "fire_resolution_images", "resolution_id", "fire_resolutions", "CASCADE"),
    ("test_fo_fire_fk", "field_officers", "fire_id", "firespots", "SET NULL"),
    ("test_fr_officer_fk", "fire_resolutions", "officer_id", "field_officers", "SET NULL"),
)
_ADD_FKS_SQL = (
    "DO $$\nBEGIN\n"
    + "".join(
        f"    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{name}' "
        f"AND connamespace = '{TEST_SCHEMA}'::regnamespace) THEN\n"
        f"        ALTER TABLE {TEST_SCHEMA}.{tbl} ADD CONSTRAINT {name} FOREIGN KEY ({col}) "
        f"REFERENCES {TEST_SCHEMA}.{ref} (id) ON DELETE {action};\n"
        "    END IF;\n"
        for name, tbl, col, ref, action in _TEST_FKS
    )
    + "END $$;"
)


async def ensure_test_schema(conn: AsyncConnection) -> None:
    """Create/refresh the test schema; run from the boot DDL under its advisory lock."""
    await conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {TEST_SCHEMA}"))
    for table in TEST_TABLES:
        await conn.execute(
            text(
                f"CREATE TABLE IF NOT EXISTS {TEST_SCHEMA}.{table} (LIKE public.{table} "
                "INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)"
            )
        )
    await conn.execute(text(_SYNC_COLUMNS_SQL))
    await conn.execute(text(_ADD_FKS_SQL))


# ------------------------------------------------------------------ officer mirror

# Copies officers' identity/location into the test schema without their bookings.
# Location pings keep writing production (real tracking never pauses) and are
# mirrored here while a drill runs, so the drill map shows live positions.
_UPSERT_OFFICERS_SQL = f"""
INSERT INTO {TEST_SCHEMA}.field_officers
    (id, user_id, fire_id, name, appointed, active, last_location, last_updated, note)
SELECT id, user_id, NULL, name, false, active, last_location, last_updated, note
FROM public.field_officers
{{where}}
ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    name = EXCLUDED.name,
    active = EXCLUDED.active,
    last_location = EXCLUDED.last_location,
    last_updated = EXCLUDED.last_updated,
    note = EXCLUDED.note
"""
_SYNC_ALL_OFFICERS_SQL = _UPSERT_OFFICERS_SQL.format(where="")
# Per-officer mirror on every drill-time location ping: a plain UPDATE (fire_id
# untouched) so it raises only the throttled 'field_officers' NOTIFY, not the
# unthrottled booking one an INSERT ... ON CONFLICT would.
_MIRROR_ONE_OFFICER_SQL = f"""
UPDATE {TEST_SCHEMA}.field_officers t
SET user_id = p.user_id, name = p.name, active = p.active,
    last_location = p.last_location, last_updated = p.last_updated, note = p.note
FROM public.field_officers p
WHERE p.id = t.id AND p.user_id = :uid
"""
_ADD_ONE_OFFICER_SQL = _UPSERT_OFFICERS_SQL.format(where="WHERE user_id = :uid")
_PRUNE_OFFICERS_SQL = f"""
DELETE FROM {TEST_SCHEMA}.field_officers t
WHERE NOT EXISTS (SELECT 1 FROM public.field_officers p WHERE p.id = t.id)
"""
_RELEASE_TEST_BOOKINGS_SQL = f"""
UPDATE {TEST_SCHEMA}.field_officers SET fire_id = NULL, appointed = false
WHERE fire_id IS NOT NULL
RETURNING user_id
"""


async def sync_test_officers(session: AsyncSession) -> None:
    """Bring the test copy of field_officers up to date with production."""
    await session.execute(text(_SYNC_ALL_OFFICERS_SQL))
    await session.execute(text(_PRUNE_OFFICERS_SQL))


async def mirror_officer(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Copy one officer's production row into the test schema (keeps its test booking).

    Flushes first so pending ORM changes to the production row are what gets copied.
    """
    await session.flush()
    updated = await session.execute(text(_MIRROR_ONE_OFFICER_SQL).bindparams(uid=user_id))
    if updated.rowcount == 0:
        await session.execute(text(_ADD_ONE_OFFICER_SQL).bindparams(uid=user_id))


# --------------------------------------------------------------------- mode switch


async def real_bookings_count() -> int:
    """Officers currently holding a real fire; those jobs are hidden during a drill."""
    async with async_session_maker() as session:
        return (
            await session.execute(
                text("SELECT count(*) FROM public.field_officers WHERE fire_id IS NOT NULL")
            )
        ).scalar_one()


async def set_test_mode(user: User, enabled: bool) -> dict[str, Any]:
    """Turn Test mode on/off for the whole system.

    On: refreshes the officer mirror so every officer can take part. Off: releases
    every drill booking and tells those officers' apps to refresh. Real bookings are
    never touched; they reappear when the drill ends. The switch itself is a real
    audit event.
    """
    await reload()
    if test_mode_on() == enabled:
        return test_mode_state()
    value = {
        "enabled": enabled,
        "since": datetime.now(timezone.utc).isoformat() if enabled else None,
        "by": user.email if enabled else None,
    }
    released: list[uuid.UUID] = []
    async with async_session_maker() as session:
        await session.execute(
            insert(AppSetting)
            .values(key=_KEY, value=json.dumps(value))
            .on_conflict_do_update(
                index_elements=["key"], set_={"value": json.dumps(value)}
            )
        )
        if enabled:
            await sync_test_officers(session)
        else:
            released = list(
                (await session.execute(text(_RELEASE_TEST_BOOKINGS_SQL))).scalars().all()
            )
        audit(
            session,
            actor=user,
            action="test.mode",
            entity_type="settings",
            entity_id=_KEY,
            detail={"enabled": enabled, "released_officers": len(released)},
        )
        # Delivered at commit; every replica's pg_listener reloads the flag.
        await session.execute(
            text("SELECT pg_notify('firenet_changes', :tag)").bindparams(
                tag=MODE_NOTIFY_TAG
            )
        )
        await session.commit()
    _apply(value)
    logger.info("test mode %s by user=%s", "on" if enabled else "off", user.id)
    await _push_released(
        released, "[ทดสอบ] สิ้นสุดการทดสอบ", "ปิดโหมดทดสอบแล้ว งานทดสอบของคุณถูกยกเลิก"
    )
    return test_mode_state()


async def _push_released(released: list[uuid.UUID], title: str, body: str) -> None:
    """Tell officers whose drill booking was dropped to refresh their app."""
    if not released:
        return
    async with async_session_maker() as session:
        for uid in released:
            await send_push(session, uid, title=title, body=body, data={"type": "fire_cancelled"})
        await session.commit()


# -------------------------------------------------------------------------- replay

# A "day" is a calendar day in the ingest timezone (the operational Thai day), so a
# picked day matches what dispatchers call that day's fires. Every query below groups
# or filters on this one expression.
_DAY_SQL = "(f.detected_at AT TIME ZONE :tz)::date"
# Optional filters: a NULL bind switches its condition off, so the SQL stays constant.
_PROVINCE_COND = "(CAST(:province AS text) IS NULL OR f.detail->>'PROVINCE' = :province)"
_DAY_FILTERS = f"""(CAST(:since AS timestamptz) IS NULL OR f.detected_at >= :since)
  AND (CAST(:until AS timestamptz) IS NULL OR f.detected_at < :until)
  AND {_PROVINCE_COND}"""

_DAYS_SQL = f"""
SELECT {_DAY_SQL} AS day,
       count(*) AS total,
       count(*) FILTER (WHERE f.expired) AS expired,
       count(*) FILTER (WHERE f.false_alarm AND NOT f.expired) AS false_alarm,
       count(*) FILTER (WHERE f.status AND NOT f.expired AND NOT f.false_alarm) AS resolved,
       count(*) FILTER (WHERE NOT f.status) AS open,
       count(DISTINCT f.detail->>'PROVINCE') AS provinces
FROM public.firespots f
WHERE {_DAY_FILTERS}
GROUP BY 1
ORDER BY 1 DESC
LIMIT :limit OFFSET :offset
"""
_DAYS_TOTAL_SQL = f"SELECT count(DISTINCT {_DAY_SQL}) FROM public.firespots f WHERE {_DAY_FILTERS}"
# Copies already in the drill, per source day (from the replay stamp on each copy).
_REPLAYED_PER_DAY_SQL = f"""
SELECT ((f.detail->'replay'->>'original_detected_at')::timestamptz AT TIME ZONE :tz)::date
           AS day,
       count(*) AS n
FROM {TEST_SCHEMA}.firespots f
WHERE f.detail->'replay' IS NOT NULL AND {_PROVINCE_COND}
GROUP BY 1
"""


async def list_replay_days(
    *,
    since: datetime | None = None,
    until: datetime | None = None,
    province: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> dict[str, Any]:
    """Days of real fires an admin can replay, newest first (read-only on production).

    Each day carries its fire count broken down by the fires' current outcome (most
    past fires are expired) plus how many copies of that day already sit in the test
    data (``replayed``). ``province`` narrows both the counts and a later replay.
    """
    binds = {"tz": settings.INGEST_TIMEZONE, "province": province or None}
    day_binds = {**binds, "since": since, "until": until}
    async with async_session_maker() as session:
        total = (await session.execute(text(_DAYS_TOTAL_SQL), day_binds)).scalar_one()
        rows = (
            await session.execute(
                text(_DAYS_SQL), {**day_binds, "limit": limit, "offset": offset}
            )
        ).mappings().all()
        replayed = {
            r.day: r.n
            for r in await session.execute(text(_REPLAYED_PER_DAY_SQL), binds)
        }
    return {
        "total": total,
        "items": [
            {**r, "day": r["day"].isoformat(), "replayed": replayed.get(r["day"], 0)}
            for r in rows
        ],
    }


# One set-based copy from production into the test schema of every fire detected on
# the chosen days. The source rows are only read: an expired fire stays expired in
# real history. Each copy starts as a fresh, open, unbooked fire with no resolution,
# detected "now" so the live-map window shows it; the source id/time/status ride along
# in detail.replay (used for the per-day "replayed" counts).
_REPLAY_SQL = f"""
INSERT INTO {TEST_SCHEMA}.firespots
    (id, external_id, name, detail, region_id, detected_at, location,
     status, expired, false_alarm, officer_id, resolve_time)
SELECT gen_random_uuid(),
       'test:' || f.id::text || ':' || substr(md5(random()::text), 1, 8),
       f.name,
       f.detail || jsonb_build_object('replay', jsonb_build_object(
           'source_fire_id', f.id::text,
           'original_detected_at', f.detected_at,
           'original_status', CASE
               WHEN f.expired THEN 'expired'
               WHEN f.false_alarm THEN 'false_alarm'
               WHEN f.status THEN 'resolved'
               ELSE 'open'
           END
       )),
       f.region_id, now(), f.location,
       false, false, false, NULL, NULL
FROM public.firespots f
WHERE {_DAY_SQL} = ANY(CAST(:days AS date[])) AND {_PROVINCE_COND}
RETURNING id
"""


async def replay_days(
    user: User, days: list[date], province: str | None = None
) -> int:
    """Copy every real fire detected on the chosen days into the drill as open fires.

    Returns the number of copies made. The INSERT fires the test firespots NOTIFY
    trigger, so the new fires reach every connected console live.
    """
    if not test_mode_on():
        raise TestModeConflict("test_mode_off")
    days = sorted(set(days))
    binds = {"tz": settings.INGEST_TIMEZONE, "days": days, "province": province or None}
    async with mode_session(test=True) as session:
        created = (await session.execute(text(_REPLAY_SQL), binds)).scalars().all()
        # Written to the test audit log: the replay is part of the drill.
        audit(
            session,
            actor=user,
            action="test.replay",
            entity_type="fire",
            detail={
                "days": [d.isoformat() for d in days],
                "province": province,
                "replayed": len(created),
            },
        )
        await session.commit()
    logger.info(
        "replayed %d fires from %d day(s) into test mode by user=%s",
        len(created),
        len(days),
        user.id,
    )
    return len(created)


# --------------------------------------------------------------------------- clear

# Every table of the test FK group is listed explicitly (no CASCADE), so this can
# never reach beyond the test schema. The officer mirror is rebuilt right after.
_TRUNCATE_SQL = "TRUNCATE " + ", ".join(f"{TEST_SCHEMA}.{t}" for t in TEST_TABLES)


async def clear_test_data(user: User) -> dict[str, int]:
    """Reset a running drill: wipe its fires, resolutions, evidence and audit log.

    Only while Test mode is on. Drill bookings are dropped (those officers get a
    push) and the officer mirror is rebuilt at once, so the drill carries on with
    an empty fire list. The reset is the first entry of the fresh drill audit log.
    """
    await reload()
    if not test_mode_on():
        raise TestModeConflict("test_mode_off")
    async with mode_session(test=True) as session:
        fires = (
            await session.execute(text(f"SELECT count(*) FROM {TEST_SCHEMA}.firespots"))
        ).scalar_one()
        resolutions = (
            await session.execute(
                text(f"SELECT count(*) FROM {TEST_SCHEMA}.fire_resolutions")
            )
        ).scalar_one()
        released = list(
            (await session.execute(text(_RELEASE_TEST_BOOKINGS_SQL))).scalars().all()
        )
        await session.execute(text(_TRUNCATE_SQL))
        await sync_test_officers(session)
        audit(
            session,
            actor=user,
            action="test.clear",
            entity_type="settings",
            entity_id=_KEY,
            detail={"fires": fires, "resolutions": resolutions},
        )
        # TRUNCATE fires no NOTIFY trigger: tell every console the drill fires are gone.
        await session.execute(text("SELECT pg_notify('firenet_changes', 'firespots')"))
        await session.commit()
    try:
        await storage.remove_objects(await storage.list_keys(EVIDENCE_PREFIX))
    except Exception as exc:
        # DB side is already clean; leftover objects are harmless and can be retried.
        logger.warning("test evidence cleanup failed: %s", exc)
    logger.info("test data cleared by user=%s fires=%d", user.id, fires)
    await _push_released(
        released, "[ทดสอบ] รีเซ็ตการทดสอบ", "ล้างข้อมูลทดสอบแล้ว งานทดสอบของคุณถูกยกเลิก"
    )
    return {"fires": fires, "resolutions": resolutions}
