"""Entity linking: conversion of the draft table, lexical and fuzzy matching in three scripts, honesty rules."""

import json
import unicodedata

import pytest

from app.extraction.linking import Linker, convert_draft, load_concepts, norm

DRAFT = (
    "English\tGujarati\tHindi\n"
    "fever\tતાવ\tबुखार\n"
    "cough\tખાંસી / ઉધરસ\tखांसी\n"
    "cold (runny nose)\tશરદી\tजुकाम / सर्दी\n"
    "chest pain\tછાતીમાં દુખાવો\tसीने में दर्द\n"
    "back pain\tકમરનો દુખાવો\tकमर दर्द\n"
)


@pytest.fixture
def linker(tmp_path):
    path = tmp_path / "c.json"
    path.write_text(json.dumps(convert_draft(DRAFT), ensure_ascii=False), encoding="utf-8")
    return Linker(load_concepts(path))


def test_conversion_marks_everything_unreviewed_with_internal_ids_and_null_snomed():
    data = convert_draft(DRAFT)
    concepts = data["concepts"]
    assert [c["id"] for c in concepts] == ["c001", "c002", "c003", "c004", "c005"]
    assert all(c["review_status"] == "unreviewed" and c["snomed_id"] is None for c in concepts)
    assert concepts[1]["labels"]["gu"] == ["ખાંસી", "ઉધરસ"]
    assert "cold" in concepts[2]["labels"]["en"] and "runny nose" in concepts[2]["labels"]["en"]


def test_a_snomed_id_on_an_unreviewed_concept_is_refused(tmp_path):
    bad = convert_draft(DRAFT)
    bad["concepts"][0]["snomed_id"] = "12345"
    (tmp_path / "b.json").write_text(json.dumps(bad), encoding="utf-8")
    with pytest.raises(ValueError, match="snomed_id"):
        load_concepts(tmp_path / "b.json")
    with pytest.raises(ValueError, match="columns"):
        convert_draft("A\tB\nx\ty\n")


def test_exact_and_contained_matches_in_all_three_scripts(linker):
    assert linker.link("symptom", "Fever").concept_id == "c001"
    assert linker.link("symptom", "તાવ").method == "exact"
    assert linker.link("symptom", "बुखार").concept_id == "c001"
    hit = linker.link("symptom", "No chest pain")
    assert (hit.concept_id, hit.method) == ("c004", "contained")
    assert linker.link("symptom", "ઝાડા નથી") is None
    assert linker.link("symptom", "ઉધરસ ખૂબ છે").concept_id == "c002"


def test_unicode_normalisation_and_word_boundaries(linker):
    decomposed = unicodedata.normalize("NFD", "ખાંસી")
    assert linker.link("symptom", decomposed).concept_id == "c002"
    assert norm("  Fever!! ") == "fever"
    assert linker.link("symptom", "scolded") is None  # 'cold' only matches as a whole word


def test_fuzzy_match_needs_high_similarity_and_short_forms_are_not_fuzzy(linker):
    hit = linker.link("symptom", "chest paine")
    assert hit.method == "fuzzy" and hit.concept_id == "c004" and hit.score >= 0.85
    assert linker.link("symptom", "chest") is None
    assert linker.link("symptom", "fevr").concept_id == "c001"
    assert linker.link("symptom", "feet") is None


def test_ties_between_concepts_are_ambiguous_and_other_fact_types_are_not_linked(tmp_path):
    two = {
        "concepts": [
            {"id": "a", "labels": {"en": ["pain"]}},
            {"id": "b", "labels": {"hi": ["pain"]}},
            {"id": "c", "labels": {"en": ["fever"]}},
        ]
    }
    (tmp_path / "t.json").write_text(json.dumps(two), encoding="utf-8")
    linker = Linker(load_concepts(tmp_path / "t.json"))
    assert linker.link("symptom", "pain") is None
    assert linker.link("allergy", "fever") is None
    assert linker.link("symptom", "fever").review_status == "unreviewed"


def test_precision_check_counts_correct_wrong_and_unlinked(linker, tmp_path):
    from app.extraction.linking import precision_check

    gold = tmp_path / "g.md"
    rows = [
        "## clip90",
        "| type | value | negated | uncertain | evidence quote |",
        "|---|---|---|---|---|",
        "| symptom | fever | no | no | તાવ છે |",
        "| symptom | cough (dry) | no | no | खांसी |",
        "| symptom | back pain | no | no | છાતીમાં દુખાવો |",
        "| symptom | weakness | no | no | થોડું દુખે છે |",
    ]
    gold.write_text(chr(10).join(rows) + chr(10), encoding="utf-8")
    counts = precision_check(linker, gold)
    assert counts["gold_symptoms"] == 4 and counts["linked"] == 3
    assert counts["correct"] == 2 and counts["wrong"] == 1 and counts["unlinked"] == 1
    assert counts["gold_value_not_in_list"] == 1
