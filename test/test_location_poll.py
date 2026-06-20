"""Effective location-poll cadence: default when unset, floor on low overrides.

Pins the spec the superuser flow promises: 10 -> 10, 0.5 -> 1 (floor), unset -> 5.
"""
from app.router.officers import _effective_poll_minutes


def test_unset_uses_default():
    assert _effective_poll_minutes(None) == 5


def test_high_override_passes_through():
    assert _effective_poll_minutes("10") == 10


def test_below_floor_is_clamped():
    assert _effective_poll_minutes("0.5") == 1
    assert _effective_poll_minutes("1") == 1
