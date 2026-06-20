"""number_new_fires: per-(tumbon, day) naming that continues across ingest runs
and never renames an already-stored fire."""
from app.db_control.fires import number_new_fires


def _p(ext, tumboon="บ้านโป่ง", day="2026-06-20"):
    return {"external_id": ext, "tumboon": tumboon, "day": day}


def test_numbers_from_one_on_empty_db():
    rows = number_new_fires([_p("a"), _p("b")], set(), {})
    assert [r["name"] for r in rows] == ["บ้านโป่ง #1", "บ้านโป่ง #2"]


def test_continues_from_seed_within_same_day():
    # 2 already on record for this tumbon+day -> next run starts at #3
    rows = number_new_fires([_p("c"), _p("d")], set(), {("บ้านโป่ง", "2026-06-20"): 2})
    assert [r["name"] for r in rows] == ["บ้านโป่ง #3", "บ้านโป่ง #4"]


def test_skips_already_stored():
    rows = number_new_fires([_p("a"), _p("b")], {"a"}, {("บ้านโป่ง", "2026-06-20"): 1})
    # 'a' kept its old name (dropped here); only 'b' is numbered, continuing from 1
    assert [r["external_id"] for r in rows] == ["b"]
    assert rows[0]["name"] == "บ้านโป่ง #2"


def test_separate_counters_per_day_and_tumbon():
    rows = number_new_fires(
        [_p("a", day="2026-06-20"), _p("b", day="2026-06-21"), _p("c", tumboon="ในเมือง")],
        set(), {},
    )
    names = {r["external_id"]: r["name"] for r in rows}
    assert names == {"a": "บ้านโป่ง #1", "b": "บ้านโป่ง #1", "c": "ในเมือง #1"}


if __name__ == "__main__":
    test_numbers_from_one_on_empty_db()
    test_continues_from_seed_within_same_day()
    test_skips_already_stored()
    test_separate_counters_per_day_and_tumbon()
    print("ok")
