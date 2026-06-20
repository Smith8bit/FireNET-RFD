"""Pure-logic checks for the permission catalog: implication expansion, the
role->preset fallback for un-backfilled rows, and create-payload sanitization.
No DB — just the synchronous helpers."""
from app.db_control.permission import (
    ALL_PERMISSIONS,
    PRESETS,
    effective_perms,
    expand,
)
from app.ws.dispatcher_handlers import _clean_permissions


def test_presets_are_known_permissions():
    for name, perms in PRESETS.items():
        assert perms <= ALL_PERMISSIONS, f"{name} has unknown perms"


def test_action_implies_view():
    assert "officers.view" in expand({"officer.manage"})
    assert {"officers.view", "fires.view"} <= expand({"fire.appoint"})
    # a bare view permission implies nothing extra
    assert expand({"fires.view"}) == {"fires.view"}


def test_role_fallback_when_no_explicit_perms():
    # empty set + known role -> the role preset (expanded)
    assert effective_perms("dispatcher", []) == expand(PRESETS["dispatcher"])
    # field_officer is not a console role -> no permissions
    assert effective_perms("field_officer", []) == set()


def test_explicit_perms_override_role_fallback():
    # an explicit set is used verbatim (expanded), the role preset is ignored
    assert effective_perms("dispatcher", ["fires.view"]) == {"fires.view"}


def test_clean_permissions_filters_and_defaults():
    assert _clean_permissions(["officer.manage", "bogus"], default=PRESETS["viewer"]) == ["officer.manage"]
    # nothing valid given -> default preset
    assert _clean_permissions([], default=PRESETS["viewer"]) == sorted(PRESETS["viewer"])
    assert _clean_permissions("not-a-list", default=PRESETS["viewer"]) == sorted(PRESETS["viewer"])


if __name__ == "__main__":
    test_presets_are_known_permissions()
    test_action_implies_view()
    test_role_fallback_when_no_explicit_perms()
    test_explicit_perms_override_role_fallback()
    test_clean_permissions_filters_and_defaults()
    print("ok")
