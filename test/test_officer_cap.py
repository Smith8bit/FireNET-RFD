"""Officer-fetch cap: a national/large-region admin must never be handed the
whole fleet. _fetch_officers caps every query at OFFICER_MAP_MAX. Verified by
inspecting the SQL the function emits (no DB needed)."""
import app.ws.officer_handlers as oh
from app.config import get_settings

CAP = get_settings().OFFICER_MAP_MAX


class _Result:
    def mappings(self):
        return self

    def all(self):
        return []


class _CaptureSession:
    """Records the last statement executed and returns an empty result set."""
    def __init__(self):
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return _Result()


class _SuperUser:
    is_superuser = True
    id = "00000000-0000-0000-0000-000000000001"
    email = "nat@x"


async def test_superuser_fetch_is_capped():
    session = _CaptureSession()
    result = await oh._fetch_officers(session, _SuperUser())

    stmt = session.statements[-1]
    sql = str(stmt)
    assert "LIMIT" in sql.upper()
    assert stmt.compile().params.get("cap") == CAP
    assert result == []


async def test_explicit_limit_overrides_default_cap():
    session = _CaptureSession()
    await oh._fetch_officers(session, _SuperUser(), limit=50)
    assert session.statements[-1].compile().params.get("cap") == 50


def test_cap_clause_orders_by_freshness():
    # the cap keeps the most-recently-active officers, not an arbitrary slice
    clause = oh._OFFICERS_ORDER_CAP.upper()
    assert "ORDER BY" in clause and "LAST_UPDATED DESC" in clause
    assert "LIMIT :CAP" in clause
