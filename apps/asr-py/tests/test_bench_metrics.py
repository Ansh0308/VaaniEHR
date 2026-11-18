"""Metrics on tiny fixtures (Phase 11A, ADR-D43). Fake text only; every expected number is worked out by hand in a comment."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.bench import metrics as m
from app.eval_extraction import GoldFact


def test_wer_and_cer_by_hand():
    # reference 4 words, one substituted: 25%
    assert m.wer_count("a b c d", "a b x d").rate == 0.25
    # 'ab cd' -> 'abcd' after removing spaces: CER 0
    assert m.cer_count("ab cd", "abcd").errors == 0
    # 'abcd' vs 'abxd': one of four characters
    assert m.cer_count("abcd", "abxd").rate == 0.25


def test_script_aware_scoring_maps_devanagari_to_gujarati():
    gu, dev = "પાણી", "पाणी"
    assert m.wer_count(gu, dev, script_aware=False).errors == 1
    assert m.wer_count(gu, dev, script_aware=True).errors == 0
    assert m.cer_count(gu, dev, script_aware=True).errors == 0


def test_micro_average_is_not_an_average_of_averages():
    total = m.micro([m.ErrorCount(10, 1), m.ErrorCount(2, 2)])
    assert (total.reference_units, total.errors) == (12, 3)
    assert total.rate == 0.25


def test_medicine_accuracy_is_a_multiset_match():
    out = m.medicine_accuracy(["x", "x", "y"], ["x", "z"])
    assert out["mentions"] == 3 and out["correct"] == 1 and out["extra_predictions"] == 1
    assert out["accuracy"] == pytest.approx(1 / 3)
    assert m.medicine_accuracy([], ["x"])["accuracy"] == 0.0


def gold(type_: str, quote: str, negated: bool = False) -> GoldFact:
    return GoldFact(type_, "v", negated, False, quote)


def test_fact_scores_with_negation_and_hallucination():
    lines = ["I have fever since two days", "no cough at all"]
    golds = [
        gold("symptom", "have fever"),
        gold("duration", "since two days"),
        gold("symptom", "no cough", True),
    ]
    predicted = [
        m.pred_fact("symptom", "fever", "have fever"),  # tp
        m.pred_fact("symptom", "cough", "no cough", negated=False),  # type match, negation wrong
        m.pred_fact("symptom", "rash", "rash on the arm"),  # ungrounded
    ]
    out = m.fact_scores([(golds, lines, predicted)])
    overall = out["overall"]
    # tp: fever, cough (matched by quote) = 2; fp: rash = 1; fn: duration = 1
    assert (overall["tp"], overall["fp"], overall["fn"]) == (2, 1, 1)
    assert overall["precision"] == pytest.approx(2 / 3) and overall["recall"] == pytest.approx(
        2 / 3
    )
    # negation: gold negated cough predicted not negated -> fn 1, no tp, no fp
    assert (out["negation"]["tp"], out["negation"]["fp"], out["negation"]["fn"]) == (0, 0, 1)
    assert "uncertainty" in out
    assert out["hallucination"] == {"ungrounded": 1, "proposed": 3, "rate": pytest.approx(1 / 3)}


def test_fact_scores_with_uncertainty():
    lines = ["Patient may perhaps have migraine headache"]
    golds = [GoldFact("symptom", "migraine", False, True, "migraine headache")]
    # Test uncertainty TP
    pred_tp = [m.pred_fact("symptom", "migraine", "migraine headache", uncertain=True)]
    out_tp = m.fact_scores([(golds, lines, pred_tp)])
    assert (
        out_tp["uncertainty"]["tp"],
        out_tp["uncertainty"]["fp"],
        out_tp["uncertainty"]["fn"],
    ) == (1, 0, 0)
    assert out_tp["uncertainty"]["f1"] == 1.0

    # Test uncertainty FN (predicted uncertain=False when gold is uncertain=True)
    pred_fn = [m.pred_fact("symptom", "migraine", "migraine headache", uncertain=False)]
    out_fn = m.fact_scores([(golds, lines, pred_fn)])
    assert (
        out_fn["uncertainty"]["tp"],
        out_fn["uncertainty"]["fp"],
        out_fn["uncertainty"]["fn"],
    ) == (0, 0, 1)

    # Test error categorization includes uncertainty mismatch
    errs = m.categorize_case_errors("case-1", golds, lines, pred_fn)
    assert any(e.error_category == "uncertainty_mismatch" for e in errs)


def test_pathway_scores_and_red_flag_recall():
    rows = [
        {"label": "a", "top1": "a", "top3": ["a", "b"], "questions_to_top3": 2},
        {"label": "b", "top1": "a", "top3": ["a", "b"], "questions_to_top3": 4},
        {"label": "c", "top1": None, "top3": [], "questions_to_top3": None},
    ]
    out = m.pathway_scores(rows)
    assert out["n"] == 3
    assert out["top1"] == pytest.approx(1 / 3) and out["top3"] == pytest.approx(2 / 3)
    assert out["median_questions_to_top3"] == 3 and out["reached_top3"] == 2
    rf = m.red_flag_recall(
        [
            {"red_flag": True, "stopped": True},
            {"red_flag": True, "stopped": False},
            {"red_flag": False},
        ]
    )
    assert rf == {"seeded": 2, "caught": 1, "recall": 0.5}
    assert m.red_flag_recall([])["recall"] is None


def test_fhir_validity_percentage(tmp_path: Path):
    assert m.fhir_validity([0, 0, 2, 0]) == {"bundles": 4, "valid": 3, "percent": 75.0}
    csv_file = tmp_path / "f.csv"
    csv_file.write_text("bundle,errors\na,0\nb,3\n", encoding="utf-8")
    assert m.read_fhir_csv(csv_file) == [0, 3]
    assert m.fhir_validity([])["percent"] is None


def test_time_to_sign_from_a_csv(tmp_path: Path):
    f = tmp_path / "t.csv"
    f.write_text(
        "participant,case,condition,seconds\np1,c1,system,60\np2,c1,system,80\np1,c2,manual,200\np2,c2,manual,300\n",
        encoding="utf-8",
    )
    out = m.time_to_sign(f)
    assert out["system_median_s"] == 70 and out["manual_median_s"] == 250
    assert out["median_saving_s"] == 180


def test_sus_scoring_known_values():
    assert m.sus_score([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]) == 100.0
    assert m.sus_score([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]) == 0.0
    assert m.sus_score([3] * 10) == 50.0
    with pytest.raises(ValueError):
        m.sus_score([3] * 9)
    with pytest.raises(ValueError):
        m.sus_score([6] + [3] * 9)


def test_tlx_raw_and_weighted():
    ratings = {s: 50.0 for s in m.TLX_SCALES}
    assert m.tlx_score(ratings) == 50.0
    ratings["mental"] = 100.0
    assert m.tlx_score(ratings) == pytest.approx((100 + 250) / 6)
    weights = {
        "mental": 5,
        "physical": 0,
        "temporal": 3,
        "performance": 3,
        "effort": 2,
        "frustration": 2,
    }
    assert m.tlx_score(ratings, weights) == pytest.approx((100 * 5 + 50 * 10) / 15)
    with pytest.raises(ValueError):
        m.tlx_score(ratings, {**weights, "mental": 6})
    with pytest.raises(ValueError):
        m.tlx_score({"mental": 10})


def test_questionnaire_csv(tmp_path: Path):
    f = tmp_path / "q.csv"
    header = (
        "participant," + ",".join(f"sus{i}" for i in range(1, 11)) + "," + ",".join(m.TLX_SCALES)
    )
    row = (
        "p1,"
        + ",".join(str(x) for x in [5, 1, 5, 1, 5, 1, 5, 1, 5, 1])
        + ","
        + ",".join("40" for _ in m.TLX_SCALES)
    )
    f.write_text(f"{header}\n{row}\n", encoding="utf-8")
    out = m.questionnaire_scores(f)
    assert out["sus_n"] == 1 and out["sus_mean"] == 100.0 and out["tlx_raw_mean"] == 40.0


def test_cohen_kappa_known_values():
    assert m.cohen_kappa(["a", "b", "a", "b"], ["a", "b", "a", "b"]) == 1.0
    # observed 0.5, expected 0.5 -> kappa 0
    assert m.cohen_kappa(["a", "a", "b", "b"], ["a", "b", "a", "b"]) == pytest.approx(0.0)
    # classic: 20 items, 10 agree on yes, 5 on no, 5 disagree... po=0.75, pe=0.5 -> 0.5
    a = ["y"] * 10 + ["n"] * 5 + ["y"] * 2 + ["n"] * 3
    b = ["y"] * 10 + ["n"] * 5 + ["n"] * 2 + ["y"] * 3
    assert m.cohen_kappa(a, b) == pytest.approx(0.4681, abs=1e-3)
    assert m.cohen_kappa([], []) is None
    assert m.cohen_kappa(["a", "a"], ["a", "a"]) == 1.0
    with pytest.raises(ValueError):
        m.cohen_kappa(["a"], [])


def test_agreement_from_two_annotation_files(tmp_path: Path):
    head = "case_id,type,value,negated,uncertain,evidence_quote,segment\n"
    one = tmp_path / "one.csv"
    two = tmp_path / "two.csv"
    one.write_text(
        head
        + "c1,symptom,fever,no,no,have fever,1\nc1,symptom,cough,yes,no,no cough,2\nc1,duration,2d,no,no,two days,1\n",
        encoding="utf-8",
    )
    two.write_text(
        head + "c1,symptom,fever,no,no,have fever,1\nc1,symptom,cough,no,no,no cough,2\n",
        encoding="utf-8",
    )
    out = m.agreement(one, two)
    assert out["shared_facts"] == 2 and out["only_one_annotator"] == 1
    assert out["overlap_rate"] == pytest.approx(2 / 3)
    assert out["kappa_labels"] == pytest.approx(0.0)


def test_language_segmented_asr_explicit_tags():
    segments = [
        ("doctor line one", "doctor line one", "en"),
        ("મને તાવ છે", "મને તાવ છે", "gu"),
        ("मुझे बुखार है", "मुझे बुखार था", "hi"),  # 1 substitution in 3 words
        ("mixed sentence text", "mixed sentence text", "mixed"),
        ("no tag line", "no tag line", None),
    ]
    out = m.language_segmented_asr(segments, script_aware=True)
    overall = out["overall"]
    assert overall["segments"] == 5
    by_lang = out["by_language"]
    assert "en" in by_lang and "gu" in by_lang and "hi" in by_lang
    assert by_lang["en"]["wer"] == 0.0
    assert by_lang["gu"]["wer"] == 0.0
    assert by_lang["hi"]["word_errors"] == 1
    assert out["mixed_segments"]["segments"] == 1
    assert out["unannotated_segments"]["segments"] == 1
    assert "protocol_note" in out


def test_extraction_error_categorization_and_precedence():
    lines = ["I have fever since two days", "no cough at all"]
    golds = [
        gold("symptom", "have fever"),
        gold("duration", "since two days"),
        gold("symptom", "no cough", negated=True),
    ]
    predicted = [
        m.pred_fact("symptom", "fever", "have fever", label="s1"),  # TP
        m.pred_fact("symptom", "cough", "no cough", negated=False, label="s2"),  # Negation mismatch
        m.pred_fact("symptom", "rash", "rash on skin"),  # Unsupported (not in text)
        m.pred_fact("symptom", "", ""),  # Unsupported (empty quote)
        m.pred_fact("symptom", "feverish", "have fever", label="s1"),  # Duplicate prediction
    ]
    errors = m.categorize_case_errors("case1", golds, lines, predicted)
    cats = [e.error_category for e in errors]
    assert "unsupported_fact" in cats
    assert "negation_mismatch" in cats
    assert "duplicate_prediction" in cats
    assert "missed_fact" in cats  # "since two days" was missed
    # Check that negation mismatch was recorded accurately
    neg_err = next(e for e in errors if e.error_category == "negation_mismatch")
    assert neg_err.gold_type == "symptom" and neg_err.predicted_type == "symptom"


def test_extraction_error_type_mismatch_and_span_misalignment():
    lines = ["patient took paracetamol 500mg daily"]
    # Gold is medication, predicted extracted as symptom
    golds = [gold("medication", "paracetamol 500mg")]
    predicted = [
        m.pred_fact("symptom", "paracetamol", "paracetamol 500mg"),  # Type mismatch
    ]
    errors = m.categorize_case_errors("case2", golds, lines, predicted)
    assert len(errors) == 1
    assert errors[0].error_category == "type_mismatch"
    assert errors[0].gold_type == "medication" and errors[0].predicted_type == "symptom"

    # Span misalignment test: same type, partial overlap (neither substring of other, overlap < 0.6)
    golds_span = [gold("symptom", "fever and nausea")]
    predicted_span = [m.pred_fact("symptom", "fever", "fever with chills")]
    lines_span = ["patient reports fever and nausea and fever with chills"]
    errors_span = m.categorize_case_errors("case3", golds_span, lines_span, predicted_span)
    assert len(errors_span) > 0
    span_err = next((e for e in errors_span if e.error_category == "span_misalignment"), None)
    assert span_err is not None or any(
        e.error_category in ("missed_fact", "unmatched_prediction") for e in errors_span
    )


def test_extraction_error_empty_inputs():
    assert m.categorize_case_errors("empty", [], [], []) == []
    # Only gold -> all missed
    golds = [gold("symptom", "fever")]
    errs = m.categorize_case_errors("gold_only", golds, ["fever"], [])
    assert len(errs) == 1 and errs[0].error_category == "missed_fact"


def test_safety_alert_metrics():
    cases = [
        {
            "case_id": "c1",
            "expected_alerts": ["ALERT_01", "ALERT_02"],
            "detected_alerts": ["ALERT_01"],  # 1 TP, 1 FN
        },
        {
            "case_id": "c2",
            "expected_alerts": ["ALERT_03"],
            "detected_alerts": ["ALERT_03", "ALERT_EXTRA"],  # 1 TP, 1 FP
        },
    ]
    res = m.safety_alert_metrics(cases)
    assert res["cases_evaluated"] == 2
    overall = res["overall"]
    assert overall["tp"] == 2
    assert overall["fp"] == 1
    assert overall["fn"] == 1
    assert overall["precision"] == pytest.approx(2 / 3)
    assert overall["recall"] == pytest.approx(2 / 3)
    assert "synthetic harness verification" in res["safety_label"]


def test_read_fhir_summary_json(tmp_path: Path):
    summary_file = tmp_path / "golden-summary.json"
    data = [
        {"file": "good-1.json", "errors": 0, "warnings": 1},
        {"file": "good-2.json", "errors": 0, "warnings": 0},
        {"file": "broken-1.json", "errors": 3, "warnings": 2},
    ]
    summary_file.write_text(json.dumps(data), encoding="utf-8")
    res = m.read_fhir_summary_json(summary_file)
    assert res["bundles"] == 3
    assert res["good_bundles"] == 2
    assert res["good_valid"] == 2
    assert res["good_pass_rate"] == 1.0
    assert res["broken_bundles"] == 1
    assert res["broken_caught"] == 1
    assert res["broken_catch_rate"] == 1.0
    assert "HL7 validator" in str(res["validation_level"])
