"""Scope-visibility isolation on the real peak load.

The whole capacity story rests on visibility being correct: a province admin must
see ONLY its province's fires, a region admin exactly the provinces beneath it,
and a national superuser everything. If that leaks, the scope buckets (and the
per-connection payloads) are wrong. These pin the invariants the fire payload and
the fan-out scope keys depend on, against the real 15 Apr 2026 distribution.
"""
import pytest

from _sim_workload import SimUser, SimWorld, load_real_day

REAL = load_real_day("2026-04-15")
if REAL is None:
    pytest.skip("real fire fixture missing and feed unreachable", allow_module_level=True)

WORLD = SimWorld(REAL["by_path"])


def _ids(user: SimUser) -> set[str]:
    return {f["id"] for f in WORLD.fire_list_for(user)}


def _province(path: str, level="province") -> SimUser:
    return SimUser(1, "p@x", False, (path,), level)


def test_superuser_sees_every_fire():
    nat = SimUser(0, "nat@x", True, (), "national")
    assert len(_ids(nat)) == WORLD.national_fires


def test_province_admin_sees_only_its_own_province():
    busiest = WORLD.fire_paths[0]
    other = WORLD.fire_paths[1]
    seen = _ids(_province(busiest))
    assert len(seen) == WORLD.fire_by_path[busiest]
    assert all(fid.startswith(busiest + "-") for fid in seen)
    # nothing from any other province leaks in
    assert not any(fid.startswith(other + "-") for fid in seen)


def test_region_admin_sees_exactly_its_provinces():
    # pick a region that actually spans more than one burned province
    region = next(r for r, ps in WORLD.provinces_by_region.items() if len(ps) > 1)
    children = WORLD.provinces_by_region[region]
    admin = SimUser(2, "reg@x", False, (region,), "region")

    seen = _ids(admin)
    assert len(seen) == sum(WORLD.fire_by_path[p] for p in children)
    # every fire belongs to a province under this region, and all children appear
    assert all(any(fid.startswith(p + "-") for p in children) for fid in seen)
    for p in children:
        assert any(fid.startswith(p + "-") for fid in seen)


def test_region_and_its_provinces_share_no_cross_region_leak():
    region = next(r for r, ps in WORLD.provinces_by_region.items() if len(ps) > 1)
    other_region = next(r for r in WORLD.region_paths if r != region)
    seen = _ids(SimUser(3, "reg@x", False, (region,), "region"))
    other_children = WORLD.provinces_by_region[other_region]
    assert not any(fid.startswith(p + "-") for p in other_children for fid in seen)


def test_unassigned_admin_sees_nothing():
    """A non-superuser with no region assignment has an empty visible set — the
    real get_fires returns [] for empty user_region_paths."""
    nobody = SimUser(4, "none@x", False, (), "province")
    assert _ids(nobody) == set()


def test_scope_key_collapses_peers_and_separates_levels():
    a = SimUser(5, "a@x", False, (WORLD.fire_paths[0],), "province")
    b = SimUser(6, "b@x", False, (WORLD.fire_paths[0],), "province")
    nat1 = SimUser(7, "n1@x", True, (), "national")
    nat2 = SimUser(8, "n2@x", True, (), "national")
    region = SimUser(9, "r@x", False, (WORLD.region_paths[0],), "region")

    assert WORLD.scope_key(a) == WORLD.scope_key(b)        # same province -> one bucket
    assert WORLD.scope_key(nat1) == WORLD.scope_key(nat2)  # all superusers -> one bucket
    assert WORLD.scope_key(a) != WORLD.scope_key(nat1)     # province != national
    assert WORLD.scope_key(a) != WORLD.scope_key(region)   # province != its region
