"""Dataset spec, validator and converter (Phase 11A, ADR-D43). Fake text only."""

from __future__ import annotations

import copy
import json
from pathlib import Path

from app.bench.convert import convert
from app.bench.dataset import (
    BENCH_ROOT,
    dataset_hash,
    load_cases,
    main,
    validate_case,
    validate_folder,
)

FIXTURES = BENCH_ROOT / "fixtures"


def good() -> dict:
    return copy.deepcopy(load_cases(FIXTURES)[0])


def errors(case: dict) -> list[str]:
    return validate_case(case).errors


def test_the_tracked_fixtures_are_valid():
    report = validate_folder(FIXTURES)
    assert report.cases == 3
    assert report.errors == []


def test_the_template_is_valid():
    template = json.loads((BENCH_ROOT / "template.json").read_text(encoding="utf-8"))
    assert validate_case(template).errors == []


def test_the_validator_command_exit_codes(tmp_path: Path):
    lines: list[str] = []
    assert main(["--dir", str(FIXTURES)], out=lines.append) == 0
    bad = good()
    bad["gold_facts"][0]["evidence_quote"] = "not in the text"
    (tmp_path / f"{bad['id']}.json").write_text(json.dumps(bad), encoding="utf-8")
    assert main(["--dir", str(tmp_path)], out=lines.append) == 1
    assert any("not verbatim" in line for line in lines)


def test_each_rule_catches_its_violation():
    def broken(mutate) -> list[str]:  # noqa: ANN001
        c = good()
        mutate(c)
        return errors(c)

    assert any("missing field" in e for e in broken(lambda c: c.pop("gold_facts")))
    assert any("unknown field" in e for e in broken(lambda c: c.update(extra=1)))
    assert any("schema_version" in e for e in broken(lambda c: c.update(schema_version="2")))
    assert any("id must" in e for e in broken(lambda c: c.update(id="Bad Id")))
    assert any("noise_level" in e for e in broken(lambda c: c["audio"].update(noise_level="loud")))
    assert any("sha256" in e for e in broken(lambda c: c["audio"].update(sha256="xyz")))
    assert any("role" in e for e in broken(lambda c: c["speakers"][0].update(role="nurse")))
    assert any(
        "unknown speaker" in e
        for e in broken(lambda c: c["transcript"]["segments"][0].update(speaker="s9"))
    )
    assert any("idx" in e for e in broken(lambda c: c["transcript"]["segments"][1].update(idx=5)))
    assert any("type" in e for e in broken(lambda c: c["gold_facts"][0].update(type="diagnosis")))
    assert any("'negated'" in e for e in broken(lambda c: c["gold_facts"][0].update(negated="no")))
    assert any(
        "does not exist" in e for e in broken(lambda c: c["gold_facts"][0].update(segment=99))
    )
    assert any("pathway_set" in e for e in broken(lambda c: c.update(pathway_set="real")))
    assert any("language_tags" in e for e in broken(lambda c: c.update(language_tags=["fr"])))


def test_an_evidence_quote_must_come_from_its_own_segment():
    c = good()
    c["gold_facts"][0]["segment"] = 0  # the quote lives in segment 1
    assert any("not verbatim in segment 0" in e for e in errors(c))


def test_phone_numbers_and_emails_are_refused():
    c = good()
    c["transcript"]["segments"][0]["text"] = "call 9876543210 now"
    assert any("phone number" in e for e in errors(c))
    c = good()
    c["transcript"]["segments"][0]["text"] = "write to someone@example.com"
    assert any("e-mail" in e for e in errors(c))


def test_a_gu_segment_without_gujarati_letters_only_warns():
    c = good()
    c["transcript"]["segments"][0].update(lang="gu", text="plain english words")
    report = validate_case(c)
    assert any("little Gujarati" in w for w in report.warnings)
    assert not any("Gujarati" in e for e in report.errors)


def test_audio_must_exist_and_match_its_hash(tmp_path: Path):
    c = good()
    c["audio"].update(file="audio/x.wav", sha256="0" * 64)
    assert any("not found" in w for w in validate_case(c, tmp_path).warnings)
    (tmp_path / "audio").mkdir()
    (tmp_path / "audio" / "x.wav").write_bytes(b"not really audio")
    assert any("does not match" in e for e in validate_case(c, tmp_path).errors)
    c["audio"]["file"] = "../escape.wav"
    assert any("inside the dataset" in e for e in validate_case(c, tmp_path).errors)


def test_the_dataset_hash_changes_with_any_content():
    cases = load_cases(FIXTURES)
    before = dataset_hash(cases)
    assert before == dataset_hash(list(reversed(cases)))
    cases[0]["gold_facts"][0]["value"] += "!"
    assert dataset_hash(cases) != before


def test_the_converter_builds_valid_cases_from_the_own_voice_files(tmp_path: Path):
    src = tmp_path / "own"
    src.mkdir()
    (src / "clip02.txt").write_text(
        "Doctor line one\nPatient has fever since two days\n", encoding="utf-8"
    )
    (src / "READ_ALOUD_AND_GOLD.md").write_text(
        "## clip02 (English-led)\nD: Doctor line one\nP: Patient has fever since two days\n\n"
        "| type | value | negated | uncertain | evidence quote |\n|---|---|---|---|---|\n"
        "| symptom | fever | no | no | has fever |\n",
        encoding="utf-8",
    )
    cases, problems = convert(src, tmp_path / "out")
    assert problems == []
    case = cases[0]
    assert [s["speaker"] for s in case["transcript"]["segments"]] == ["s1", "s2"]
    assert case["gold_facts"][0]["segment"] == 1
    assert case["condition_label"] is None and case["expected_questions"] == []
    assert validate_case(case).errors == []
