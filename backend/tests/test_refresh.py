"""Branch-logic self-check for refresh-token rotation.

No DB: a fake session stands in so this runs anywhere. It guards the decisions
that matter (missing / reused / expired / happy path), not the SQL itself.
Run:  python -m tests.test_refresh   (from backend/)
"""
import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy.sql import Select  # noqa: E402

from app.auth import refresh  # noqa: E402


class FakeRow:
    def __init__(self, *, revoked_at=None, expired=False):
        self.user_id = uuid.uuid4()
        self.revoked_at = revoked_at
        delta = timedelta(days=-1) if expired else timedelta(days=30)
        self.expires_at = datetime.now(timezone.utc) + delta


class FakeResult:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row


class FakeSession:
    """Returns one preset row for the lookup SELECT; records adds (issue) and
    UPDATEs (revoke)."""

    def __init__(self, row):
        self._row = row
        self.added = []
        self.updates = 0

    async def execute(self, stmt):
        if isinstance(stmt, Select):
            return FakeResult(self._row)
        self.updates += 1  # an UPDATE … = a revoke
        return FakeResult(None)

    def add(self, obj):
        self.added.append(obj)


def run(coro):
    return asyncio.run(coro)


def test_missing_token_returns_none():
    s = FakeSession(None)
    assert run(refresh.rotate_refresh_token(s, "nope")) is None
    assert s.added == []  # nothing issued


def test_reuse_revokes_family_and_fails():
    s = FakeSession(FakeRow(revoked_at=datetime.now(timezone.utc)))
    assert run(refresh.rotate_refresh_token(s, "x")) is None
    assert s.updates == 1  # revoke_all_for_user fired
    assert s.added == []


def test_expired_returns_none():
    s = FakeSession(FakeRow(expired=True))
    assert run(refresh.rotate_refresh_token(s, "x")) is None
    assert s.added == []


def test_happy_path_rotates():
    row = FakeRow()
    s = FakeSession(row)
    result = run(refresh.rotate_refresh_token(s, "x"))
    assert result is not None
    user_id, new_raw = result
    assert user_id == row.user_id
    assert isinstance(new_raw, str) and new_raw
    assert row.revoked_at is not None  # old token retired
    assert len(s.added) == 1  # new token issued


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok  {name}")
    print("all refresh-rotation checks passed")
