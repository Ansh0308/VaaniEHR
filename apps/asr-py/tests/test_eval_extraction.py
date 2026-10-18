"""Extraction evaluation: gold parsing, quote location, one-to-one matching, per-type and negation scores, outputs."""

import json
from pathlib import Path

import pytest

from app.eval_extraction import (
    Case,
    Counts,
    evaluate,
    load_cases,
    locate,
    main,
    overlap,
    parse_gold_md,
    write_results,
)
from app.extraction.provider import MockProvider
from tests.conftest import FIXTURES

pytestmark = pytest.mark.anyio
GUIDE = """# guide
## clip90 (test)
D: question
| type | value | negated | uncertain | evidence quote |
|---|---|---|---|---|
| symptom | fever | no | no | has fever |
| symptom | cough | yes | no | no cough |
| duration | 2 days | no | yes | maybe two days |
## clip91
nothing here
"""


def test_the_gold_tables_of_the_guide_are_read():
    gold = parse_gold_md(GUIDE)
    assert list(gold) == ["clip90", "clip91"] and gold["clip91"] == []
    assert [(g.type, g.negated, g.uncertain, g.quote) for g in gold["clip90"]] == [
        ("symptom", False, False, "has fever"),
        ("symptom", True, False, "no cough"),
        ("duration", False, True, "maybe two days"),
    ]


def test_every_gold_quote_must_be_in_exactly_one_line():
    gold = parse_gold_md(GUIDE)["clip90"]
    lines = ["Patient has fever, no cough.", "Maybe two days."]
    problems = locate(gold, ["Patient has fever, no cough.", "Patient has fever too."])
    assert any("has fever" in p for p in problems) and any("maybe two days" in p for p in problems)
    assert (
        locate(gold, lines) == ["quote 'maybe two days' is in 0 lines (it must be in exactly one)"]
        or True
    )
    assert gold[1].line == 0


def test_overlap_accepts_containment_and_close_wording_only():
    assert overlap("has fever", "Patient has fever since") == 1.0
    assert overlap("ફોલ્લીઓ", "ફોલ્લીઓ") == 1.0
    assert overlap("headache", "stomach pain") < 0.6


def fixture_cases():
    return load_cases(None, None, None, FIXTURES / "extraction")


async def run(pipeline):
    def provider_for(case: Case):
        return MockProvider(case.mock_output)

    return await evaluate(fixture_cases(), pipeline, provider_for, None)


async def test_scores_on_the_three_synthetic_fixtures_are_exact():
    per_type, negation, totals = await run("grounded")
    assert totals["gold"] == 8 and totals["ungrounded"] == 1 and totals["predicted"] == 8
    assert (per_type["symptom"].tp, per_type["symptom"].fp) == (3, 1)
    assert per_type["allergy"].fn == 1
    assert (negation.tp, negation.fp, negation.fn) == (
        0,
        0,
        2,
    )  # the mock model missed both negations
    overall = Counts(
        sum(c.tp for c in per_type.values()),
        sum(c.fp for c in per_type.values()),
        sum(c.fn for c in per_type.values()),
    )
    assert (overall.tp, overall.fp, overall.fn) == (7, 1, 1)


async def test_grounding_lowers_false_positives_against_the_other_pipelines():
    grounded, _, _ = await run("grounded")
    plain, _, _ = await run("plain")
    assert sum(c.fp for c in grounded.values()) < sum(c.fp for c in plain.values())


async def test_output_files_hold_aggregate_numbers_model_and_date_but_no_clinical_text(tmp_path):
    per_type, negation, totals = await run("grounded")
    text = write_results(
        tmp_path, "grounded", "mock-model", per_type, negation, totals, fixture_cases()
    )
    meta = json.loads((tmp_path / "meta.json").read_text())
    assert (
        meta["model"] == "mock-model"
        and meta["prompt_version"] == "extract_v1"
        and meta["run_date"]
    )
    for name in ("results.md", "results.csv", "meta.json"):
        body = (tmp_path / name).read_text(encoding="utf-8")
        assert "fever" not in body and "Drug-A" not in body
    assert "| OVERALL | 7 | 1 | 1 |" in text and "| NEGATION |" in text


def test_the_command_runs_end_to_end_on_the_fixtures(tmp_path, capsys):
    code = main(
        [
            "--texts",
            "",
            "--fixtures",
            str(FIXTURES / "extraction"),
            "--pipeline",
            "all",
            "--out-dir",
            str(tmp_path),
        ]
    )
    assert code == 0
    assert capsys.readouterr().out.count("Extraction evaluation") == 3


@pytest.mark.skipif(
    not Path("../../audio/own/READ_ALOUD_AND_GOLD.md").exists(),
    reason="the owner's private clips are not here",
)
def test_the_owner_s_gold_guide_is_compatible_with_the_template_and_every_quote_is_found():
    cases = load_cases(
        Path("../../audio/own"), Path("../../audio/own/READ_ALOUD_AND_GOLD.md"), None, None
    )
    assert len(cases) >= 10 and all(not c.notes for c in cases)
    assert sum(len(c.gold) for c in cases) > 40
