"""Scope bucketing — the change that turns a broadcast from O(connections) into
O(distinct scopes). These guard the grouping/fanout invariants the whole
fan-out cost model relies on."""
import json


from app.ws.manager import Connection, fanout, group_by_scope


class FakeWS:
    """Minimal WebSocket stand-in that records what was sent."""

    def __init__(self, fail: bool = False):
        self.sent: list[str] = []
        self.fail = fail

    async def send_text(self, payload: str) -> None:
        if self.fail:
            raise RuntimeError("socket dead")
        self.sent.append(payload)


class FakeUser:
    def __init__(self, email):
        self.email = email
        self.id = email


def _conn(email, *, is_super=False, paths=(), fail=False):
    return Connection(ws=FakeWS(fail=fail), user=FakeUser(email), is_super=is_super, paths=paths)


def test_superusers_share_one_bucket():
    conns = [_conn("s1", is_super=True), _conn("s2", is_super=True)]
    groups = group_by_scope(conns)
    assert len(groups) == 1
    assert list(groups)[0] == ("\x00super",)


def test_superuser_not_bucketed_with_province_admins():
    # the sentinel keeps the national/superuser scope separate from any province
    sup = _conn("s", is_super=True)
    prov = _conn("a", paths=("th.r1.p50",))
    assert sup.scope_key != prov.scope_key
    assert len(group_by_scope([sup, prov])) == 2


def test_identical_path_sets_group_together_order_independent():
    a = _conn("a", paths=("th.r1.p50", "th.r2.p60"))
    b = _conn("b", paths=("th.r2.p60", "th.r1.p50"))
    assert a.scope_key == b.scope_key
    assert len(group_by_scope([a, b])) == 1


def test_distinct_scopes_stay_separate():
    conns = [
        _conn("s1", is_super=True),
        _conn("a1", paths=("th.r1.p50",)),
        _conn("a2", paths=("th.r1.p50",)),
        _conn("a3", paths=("th.r1.p51",)),
    ]
    groups = group_by_scope(conns)
    assert len(groups) == 3
    sizes = sorted(len(m) for m in groups.values())
    assert sizes == [1, 1, 2]


def test_empty_list_groups_to_nothing():
    assert group_by_scope([]) == {}


async def test_fanout_delivers_one_payload_to_every_member():
    members = [_conn("a"), _conn("b"), _conn("c")]
    payload = json.dumps({"fires": []})
    await fanout(members, payload)
    for m in members:
        assert m.ws.sent == [payload]


async def test_fanout_tolerates_a_dead_socket():
    good1, dead, good2 = _conn("g1"), _conn("d", fail=True), _conn("g2")
    await fanout([good1, dead, good2], "x")
    # a single broken connection must not stop delivery to the others
    assert good1.ws.sent == ["x"]
    assert good2.ws.sent == ["x"]
    assert dead.ws.sent == []
