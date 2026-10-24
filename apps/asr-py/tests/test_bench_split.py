"""Frozen split and the tuning refusal (Phase 11A, ADR-D43). Fake cases only."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from app.bench import split as sp
from app.bench.dataset import BENCH_ROOT, load_cases


def cases(n: int = 10) -> list[dict]:
    base = load_cases(BENCH_ROOT / "fixtures")[0]
    out = []
    for i in range(n):
        c = copy.deepcopy(base)
        c["id"] = f"case{i:02d}"
        c["synthetic"] = False
        out.append(c)
    return out


STATE = sp.tuning_state(["mock-model"], {"question_cap": 8})


def frozen(n: int = 10) -> tuple[dict, list[dict]]:
    cs = cases(n)
    return sp.freeze(cs, STATE), cs


def test_assignment_is_deterministic_and_partitions():
    ids = [f"c{i}" for i in range(11)]
    a, b = sp.assign(ids), sp.assign(list(reversed(ids)))
    assert a == b
    assert sorted(a["dev"] + a["test"]) == sorted(ids)
    assert len(a["test"]) == 3 and not set(a["dev"]) & set(a["test"])
    assert sp.assign(["only"]) == {"test": [], "dev": ["only"]}


def test_a_clean_state_passes():
    split, cs = frozen()
    assert sp.check_frozen(split, cs, STATE) == []


def test_synthetic_cases_are_never_in_the_split():
    cs = cases(4)
    cs[0]["synthetic"] = True
    split = sp.freeze(cs, STATE)
    assert cs[0]["id"] not in split["dev"] + split["test"]
    assert sp.check_frozen(split, cs, STATE) == []


def test_editing_a_test_case_is_detected():
    split, cs = frozen()
    target = next(c for c in cs if c["id"] in split["test"])
    target["gold_facts"][0]["value"] = "changed after the freeze"
    assert any("edited since the freeze" in r for r in sp.check_frozen(split, cs, STATE))


def test_editing_a_dev_case_is_allowed():
    split, cs = frozen()
    target = next(c for c in cs if c["id"] in split["dev"])
    target["gold_facts"][0]["value"] = "dev tuning is fine"
    assert sp.check_frozen(split, cs, STATE) == []


def test_removing_a_test_case_is_detected():
    split, cs = frozen()
    gone = split["test"][0]
    assert any(gone in r for r in sp.check_frozen(split, [c for c in cs if c["id"] != gone], STATE))


def test_a_case_added_after_the_freeze_is_flagged():
    split, cs = frozen()
    extra = copy.deepcopy(cs[0])
    extra["id"] = "late01"
    assert any("added after the freeze" in r for r in sp.check_frozen(split, [*cs, extra], STATE))


def test_a_prompt_edit_is_detected():
    split, cs = frozen()
    changed = {**STATE, "prompts": {**STATE["prompts"], "grounded": "0" * 64}}
    reasons = sp.check_frozen(split, cs, changed)
    assert len(reasons) == 1 and "'grounded' prompt was edited" in reasons[0]


def test_a_new_model_is_detected():
    split, cs = frozen()
    new = {**STATE, "models": ["mock-model", "some-new-model"]}
    assert any("some-new-model" in r for r in sp.check_frozen(split, cs, new))
    # using fewer of the frozen models is fine
    assert sp.check_frozen(split, cs, {**STATE, "models": []}) == []


def test_a_changed_threshold_is_detected():
    split, cs = frozen()
    new = {**STATE, "thresholds": {**STATE["thresholds"], "question_cap": 6}}
    assert any("threshold 'question_cap' changed" in r for r in sp.check_frozen(split, cs, new))
    dropped = {**STATE, "thresholds": {"fact_overlap": STATE["thresholds"]["fact_overlap"]}}
    assert any("no longer reported" in r for r in sp.check_frozen(split, cs, dropped))


def test_freeze_never_overwrites(tmp_path: Path):
    cdir = tmp_path / "cases"
    cdir.mkdir()
    for c in cases(6):
        (cdir / f"{c['id']}.json").write_text(json.dumps(c), encoding="utf-8")
    target = tmp_path / "split.json"
    lines: list[str] = []
    args = ["freeze", "--cases", str(cdir), "--out", str(target)]
    assert sp.main(args, out=lines.append) == 0
    first = target.read_text(encoding="utf-8")
    assert sp.main(args, out=lines.append) == 2
    assert target.read_text(encoding="utf-8") == first
    assert "protocol demonstration" in " ".join(lines)
    assert (
        sp.main(["check", "--cases", str(cdir), "--split-file", str(target)], out=lines.append) == 0
    )


@pytest.mark.parametrize("fraction", [0.2, 0.5])
def test_fraction_changes_the_test_size(fraction: float):
    assert len(sp.assign([f"c{i}" for i in range(10)], fraction)["test"]) == round(10 * fraction)
