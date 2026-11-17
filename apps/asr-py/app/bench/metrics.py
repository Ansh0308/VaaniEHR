"""Evaluation metrics (Phase 11A, ADR-D43; PRD 14.1 M-01..M-17). Pure functions, no network, tested on tiny fixtures.

Normalisation (so the numbers can be compared and reproduced):
- WER: the existing script-aware scoring in app.wer (Unicode NFC, lower-case, edge punctuation stripped, Devanagari letters
  mapped onto Gujarati by offset, Latin never mapped). Aggregates are micro averages (total errors over total reference words).
- CER: the same normalisation, then spaces removed, then edit distance over characters (combining marks are characters).
- Facts: the existing matcher in app.eval_extraction (same type and evidence-quote overlap >= 0.6, one-to-one), negation F1 with
  "negated" as the positive class.
- Hallucination rate: facts whose evidence quote is NOT a piece of the source text / all facts the model proposed (a span check
  that is independent of which pipeline produced them).
- Pathway and red-flag numbers come from the TOY pathways only and are labelled so everywhere they are shown.
"""

from __future__ import annotations

import csv
import json
import re
import statistics
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.eval_extraction import OVERLAP, Case, Counts, GoldFact, locate, overlap, score
from app.extraction.models import PredictedFact
from app.extraction.text import normalise
from app.wer import align, to_gujarati, wer_report, words


# ------------------------------------------------------------------ M-01 WER and CER
@dataclass(frozen=True)
class ErrorCount:
    reference_units: int
    errors: int

    @property
    def rate(self) -> float:
        return (
            self.errors / self.reference_units if self.reference_units else float(self.errors > 0)
        )


VALID_EXPLICIT_LANGS = {"gu", "hi", "en"}


def _chars(text: str, script_aware: bool) -> list[str]:
    joined = "".join(words(text))
    return list(to_gujarati(joined) if script_aware else joined)


def cer_count(reference: str, hypothesis: str, script_aware: bool = True) -> ErrorCount:
    ref, hyp = _chars(reference, script_aware), _chars(hypothesis, script_aware)
    ops = align(ref, hyp)
    return ErrorCount(len(ref), sum(1 for op in ops if op[0] != "ok"))


def wer_count(reference: str, hypothesis: str, script_aware: bool = True) -> ErrorCount:
    strict, aware = wer_report(reference, hypothesis)
    r = aware if script_aware else strict
    return ErrorCount(r.reference_words, r.errors)


def micro(counts: Iterable[ErrorCount]) -> ErrorCount:
    items = list(counts)
    return ErrorCount(sum(c.reference_units for c in items), sum(c.errors for c in items))


def language_segmented_asr(
    segments: Sequence[tuple[str, str, str | None]],
    script_aware: bool = True,
) -> dict[str, object]:
    """Computes overall WER/CER and breaks down metrics strictly by validated explicit segment language tags.

    segments = [(reference, hypothesis, explicit_lang_tag), ...]
    Does NOT use script detection to guess spoken language (script != language).
    Segments explicitly tagged 'gu', 'hi', or 'en' are under 'by_language'.
    Segments tagged 'mixed' are under 'mixed_segments'.
    Segments with missing or unrecognized tags are under 'unannotated_segments'.
    """
    total_words: list[ErrorCount] = []
    total_chars: list[ErrorCount] = []
    by_lang_words: dict[str, list[ErrorCount]] = defaultdict(list)
    by_lang_chars: dict[str, list[ErrorCount]] = defaultdict(list)
    mixed_words: list[ErrorCount] = []
    mixed_chars: list[ErrorCount] = []
    unannotated_words: list[ErrorCount] = []
    unannotated_chars: list[ErrorCount] = []

    for ref, hyp, tag in segments:
        w = wer_count(ref, hyp, script_aware=script_aware)
        c = cer_count(ref, hyp, script_aware=script_aware)
        total_words.append(w)
        total_chars.append(c)

        norm_tag = (tag or "").strip().lower() or None
        if norm_tag in VALID_EXPLICIT_LANGS:
            by_lang_words[norm_tag].append(w)
            by_lang_chars[norm_tag].append(c)
        elif norm_tag == "mixed":
            mixed_words.append(w)
            mixed_chars.append(c)
        else:
            unannotated_words.append(w)
            unannotated_chars.append(c)

    def pack_group(w_list: list[ErrorCount], c_list: list[ErrorCount]) -> dict[str, float | int]:
        wm = micro(w_list)
        cm = micro(c_list)
        return {
            "segments": len(w_list),
            "reference_words": wm.reference_units,
            "word_errors": wm.errors,
            "wer": wm.rate,
            "reference_chars": cm.reference_units,
            "char_errors": cm.errors,
            "cer": cm.rate,
        }

    overall = pack_group(total_words, total_chars)
    by_lang = {lang: pack_group(by_lang_words[lang], by_lang_chars[lang]) for lang in sorted(by_lang_words)}
    mixed = pack_group(mixed_words, mixed_chars)
    unannotated = pack_group(unannotated_words, unannotated_chars)

    return {
        "overall": overall,
        "by_language": by_lang,
        "mixed_segments": mixed,
        "unannotated_segments": unannotated,
        "protocol_note": (
            "Language breakdowns rely strictly on explicit segment annotations ('gu', 'hi', 'en', 'mixed'). "
            "Script detection was not used to assign spoken language. "
            "Results on small synthetic/acted test cases are protocol demonstrations and not statistically meaningful population performance."
        ),
    }


# ------------------------------------------------------------------ M-02 medicine names
def _slug(text: str) -> str:
    """Letters and digits only, lower-cased: 'Medicine-X (FAKE)' and 'medicine-x-fake' are the same name.
    (There is no Python NLEM normaliser yet; this only removes spelling-of-punctuation differences.)"""
    return "".join(ch for ch in normalise(text).casefold() if ch.isalnum())


def medicine_accuracy(gold: Sequence[str], predicted: Sequence[str]) -> dict[str, float | int]:
    """gold = the generic each spoken mention should normalise to; predicted = the generics the system produced.
    A mention is correct when its generic is among the predictions (multiset: one prediction answers one mention)."""
    pool = Counter(_slug(p) for p in predicted)
    correct = 0
    for g in gold:
        key = _slug(g)
        if pool[key] > 0:
            pool[key] -= 1
            correct += 1
    return {
        "mentions": len(gold),
        "correct": correct,
        "accuracy": correct / len(gold) if gold else 0.0,
        "extra_predictions": sum(pool.values()),
    }


# ------------------------------------------------------------------ M-03 / M-04 facts
def prf(c: Counts) -> dict[str, float]:
    return {"precision": c.precision, "recall": c.recall, "f1": c.f1}


def pred_fact(
    type_: str,
    value: str,
    quote: str,
    negated: bool = False,
    uncertain: bool = False,
    label: str | None = None,
) -> PredictedFact:
    return PredictedFact(
        type=type_,
        value=value,
        negated=negated,
        uncertain=uncertain,
        segment_label=label,
        evidence_quote=quote,
    )


@dataclass
class _Result:
    predicted: list[PredictedFact]


def fact_scores(
    cases: Sequence[tuple[Sequence[GoldFact], Sequence[str], Sequence[PredictedFact]]],
) -> dict[str, object]:
    """cases = (gold facts, source lines, predicted facts) per case. Micro P/R/F1 per type and overall, negation F1,
    hallucination rate. Gold lines are located here, so gold facts need only a quote."""
    per_type: dict[str, Counts] = defaultdict(Counts)
    negation = Counts()
    ungrounded = proposed = 0
    for gold, lines, predicted in cases:
        gold_list = [GoldFact(g.type, g.value, g.negated, g.uncertain, g.quote) for g in gold]
        locate(gold_list, list(lines))
        score(Case("x", list(lines), gold_list), _Result(list(predicted)), per_type, negation)  # type: ignore[arg-type]
        text = [normalise(line).casefold() for line in lines]
        for p in predicted:
            proposed += 1
            quote = normalise(p.evidence_quote).casefold()
            if not quote or not any(quote in line for line in text):
                ungrounded += 1
    overall = Counts(
        sum(c.tp for c in per_type.values()),
        sum(c.fp for c in per_type.values()),
        sum(c.fn for c in per_type.values()),
    )
    return {
        "per_type": {
            t: prf(c) | {"tp": c.tp, "fp": c.fp, "fn": c.fn} for t, c in sorted(per_type.items())
        },
        "overall": prf(overall) | {"tp": overall.tp, "fp": overall.fp, "fn": overall.fn},
        "negation": prf(negation) | {"tp": negation.tp, "fp": negation.fp, "fn": negation.fn},
        "hallucination": {
            "ungrounded": ungrounded,
            "proposed": proposed,
            "rate": ungrounded / proposed if proposed else 0.0,
        },
    }


@dataclass(frozen=True)
class ExtractionErrorRecord:
    case_id: str
    error_category: str
    gold_type: str
    predicted_type: str
    gold_quote: str
    predicted_quote: str
    detail: str

    def to_dict(self) -> dict[str, str]:
        return {
            "case_id": self.case_id,
            "error_category": self.error_category,
            "gold_type": self.gold_type,
            "predicted_type": self.predicted_type,
            "gold_quote": self.gold_quote,
            "predicted_quote": self.predicted_quote,
            "detail": self.detail,
        }


def _p_line(p: PredictedFact) -> int | None:
    if p.segment_label and re.fullmatch(r"s\d+", p.segment_label):
        return int(p.segment_label[1:]) - 1
    return None


def categorize_case_errors(
    case_id: str,
    gold: Sequence[GoldFact],
    lines: Sequence[str],
    predicted: Sequence[PredictedFact],
) -> list[ExtractionErrorRecord]:
    """Deterministic extraction error classification avoiding double counting.

    Precedence order:
      1. Unsupported / missing evidence quotes (ungrounded hallucination / span error)
      2. True positives and negation mismatches (matching type & span overlap >= OVERLAP)
      3. Type mismatches (unmatched predictions and gold with span overlap >= OVERLAP)
      4. Span misalignments (unmatched predictions and gold with same type, 0 < overlap < OVERLAP)
      5. Duplicate predictions (multiple predictions claiming same evidence span)
      6. Unmatched predictions (extra predictions not in gold standard)
      7. Missed facts (gold facts without corresponding prediction)
    """
    gold_list = [GoldFact(g.type, g.value, g.negated, g.uncertain, g.quote) for g in gold]
    locate(gold_list, list(lines))
    norm_lines = [normalise(l).casefold() for l in lines]

    errors: list[ExtractionErrorRecord] = []
    valid_predictions: list[tuple[int, PredictedFact]] = []

    # Step 1: Detect unsupported / missing evidence
    for pi, p in enumerate(predicted):
        quote = normalise(p.evidence_quote).casefold() if p.evidence_quote else ""
        if not quote:
            errors.append(
                ExtractionErrorRecord(
                    case_id=case_id,
                    error_category="unsupported_fact",
                    gold_type="",
                    predicted_type=p.type,
                    gold_quote="",
                    predicted_quote="",
                    detail="Missing or empty evidence quote",
                )
            )
        elif not any(quote in line for line in norm_lines):
            errors.append(
                ExtractionErrorRecord(
                    case_id=case_id,
                    error_category="unsupported_fact",
                    gold_type="",
                    predicted_type=p.type,
                    gold_quote="",
                    predicted_quote=p.evidence_quote,
                    detail="Evidence quote not verbatim in transcript text",
                )
            )
        else:
            valid_predictions.append((pi, p))

    # Step 2: Level 1 match: same type and overlap >= OVERLAP
    tp_pairs = []
    for pi, p in valid_predictions:
        p_line = _p_line(p)
        for gi, g in enumerate(gold_list):
            if p.type == g.type and (p_line is None or g.line is None or p_line == g.line):
                o = overlap(p.evidence_quote, g.quote)
                if o >= OVERLAP:
                    tp_pairs.append((o, pi, gi))

    tp_pairs.sort(key=lambda x: (x[0], -x[1], -x[2]), reverse=True)
    used_p: set[int] = set()
    used_g: set[int] = set()

    for _o, pi, gi in tp_pairs:
        if pi in used_p or gi in used_g:
            continue
        used_p.add(pi)
        used_g.add(gi)
        p = predicted[pi]
        g = gold_list[gi]
        if p.negated != g.negated:
            errors.append(
                ExtractionErrorRecord(
                    case_id=case_id,
                    error_category="negation_mismatch",
                    gold_type=g.type,
                    predicted_type=p.type,
                    gold_quote=g.quote,
                    predicted_quote=p.evidence_quote,
                    detail=f"Negation mismatch: gold negated={g.negated}, predicted negated={p.negated}",
                )
            )

    # Step 3: Level 2 match: type mismatch (different types, but overlap >= OVERLAP)
    type_pairs = []
    for pi, p in valid_predictions:
        if pi in used_p:
            continue
        p_line = _p_line(p)
        for gi, g in enumerate(gold_list):
            if gi in used_g:
                continue
            if p_line is None or g.line is None or p_line == g.line:
                o = overlap(p.evidence_quote, g.quote)
                if o >= OVERLAP:
                    type_pairs.append((o, pi, gi))

    type_pairs.sort(key=lambda x: (x[0], -x[1], -x[2]), reverse=True)
    for _o, pi, gi in type_pairs:
        if pi in used_p or gi in used_g:
            continue
        used_p.add(pi)
        used_g.add(gi)
        p = predicted[pi]
        g = gold_list[gi]
        errors.append(
            ExtractionErrorRecord(
                case_id=case_id,
                error_category="type_mismatch",
                gold_type=g.type,
                predicted_type=p.type,
                gold_quote=g.quote,
                predicted_quote=p.evidence_quote,
                detail=f"Type mismatch on evidence: gold type '{g.type}' vs predicted '{p.type}'",
            )
        )

    # Step 4: Level 3 match: span misalignment (same type, 0.0 < overlap < OVERLAP)
    span_pairs = []
    for pi, p in valid_predictions:
        if pi in used_p:
            continue
        p_line = _p_line(p)
        for gi, g in enumerate(gold_list):
            if gi in used_g:
                continue
            if p.type == g.type and (p_line is None or g.line is None or p_line == g.line):
                o = overlap(p.evidence_quote, g.quote)
                if 0.0 < o < OVERLAP:
                    span_pairs.append((o, pi, gi))

    span_pairs.sort(key=lambda x: (x[0], -x[1], -x[2]), reverse=True)
    for o, pi, gi in span_pairs:
        if pi in used_p or gi in used_g:
            continue
        used_p.add(pi)
        used_g.add(gi)
        p = predicted[pi]
        g = gold_list[gi]
        errors.append(
            ExtractionErrorRecord(
                case_id=case_id,
                error_category="span_misalignment",
                gold_type=g.type,
                predicted_type=p.type,
                gold_quote=g.quote,
                predicted_quote=p.evidence_quote,
                detail=f"Partial quote overlap ({o:.2f} < {OVERLAP}) for type '{g.type}'",
            )
        )

    # Step 5: Level 4: remaining unmatched predictions
    for pi, p in valid_predictions:
        if pi in used_p:
            continue
        is_dup = any(
            p.type == predicted[other_pi].type
            and overlap(p.evidence_quote, predicted[other_pi].evidence_quote) >= OVERLAP
            for other_pi in used_p
        )
        if is_dup:
            errors.append(
                ExtractionErrorRecord(
                    case_id=case_id,
                    error_category="duplicate_prediction",
                    gold_type="",
                    predicted_type=p.type,
                    gold_quote="",
                    predicted_quote=p.evidence_quote,
                    detail=f"Duplicate prediction of type '{p.type}' with overlapping evidence",
                )
            )
        else:
            errors.append(
                ExtractionErrorRecord(
                    case_id=case_id,
                    error_category="unmatched_prediction",
                    gold_type="",
                    predicted_type=p.type,
                    gold_quote="",
                    predicted_quote=p.evidence_quote,
                    detail=f"Predicted fact of type '{p.type}' not in gold standard",
                )
            )

    # Step 6: Level 5: remaining unmatched gold facts
    for gi, g in enumerate(gold_list):
        if gi in used_g:
            continue
        errors.append(
            ExtractionErrorRecord(
                case_id=case_id,
                error_category="missed_fact",
                gold_type=g.type,
                predicted_type="",
                gold_quote=g.quote,
                predicted_quote="",
                detail=f"Gold fact of type '{g.type}' ('{g.quote}') was not extracted",
            )
        )

    return errors


def categorize_extraction_errors(
    cases: Sequence[tuple[str, Sequence[GoldFact], Sequence[str], Sequence[PredictedFact]]],
) -> list[ExtractionErrorRecord]:
    """Categorizes extraction errors across multiple cases."""
    all_errors: list[ExtractionErrorRecord] = []
    for cid, gold, lines, predicted in cases:
        all_errors.extend(categorize_case_errors(cid, gold, lines, predicted))
    return all_errors


# ------------------------------------------------------------------ M-05..M-08 toy pathways
def pathway_scores(results: Sequence[dict]) -> dict[str, float | int | None]:
    """results = [{label, top1, top3, questions_to_top3}] from the TOY rules-only simulation."""
    labelled = [r for r in results if r.get("label")]
    n = len(labelled)
    top1 = sum(1 for r in labelled if r.get("top1") == r["label"])
    top3 = sum(1 for r in labelled if r["label"] in (r.get("top3") or []))
    asked = [r["questions_to_top3"] for r in labelled if r.get("questions_to_top3") is not None]
    return {
        "n": n,
        "top1": top1 / n if n else None,
        "top3": top3 / n if n else None,
        "median_questions_to_top3": statistics.median(asked) if asked else None,
        "reached_top3": len(asked),
    }


def red_flag_recall(results: Sequence[dict]) -> dict[str, float | int | None]:
    """results = [{red_flag: bool (gold), stopped: bool (the engine stopped on a red flag)}]."""
    seeded = [r for r in results if r.get("red_flag")]
    caught = sum(1 for r in seeded if r.get("stopped"))
    return {
        "seeded": len(seeded),
        "caught": caught,
        "recall": caught / len(seeded) if seeded else None,
    }


# ------------------------------------------------------------------ M-11 FHIR validity
def fhir_validity(errors_per_bundle: Sequence[int]) -> dict[str, float | int | None]:
    n = len(errors_per_bundle)
    ok = sum(1 for e in errors_per_bundle if e == 0)
    return {"bundles": n, "valid": ok, "percent": 100 * ok / n if n else None}


def read_fhir_csv(path: Path) -> list[int]:
    """CSV with a header; columns `bundle` and `errors` (a count)."""
    with path.open(newline="", encoding="utf-8") as handle:
        return [int(row["errors"]) for row in csv.DictReader(handle)]


def read_fhir_summary_json(path: Path) -> dict[str, object]:
    """Reads the JSON output of the HL7 FHIR validator (e.g. data/fhir/out/golden-summary.json)

    and computes golden-fixture conformance metrics.
    """
    if not path.exists():
        return {
            "bundles": 0,
            "valid": 0,
            "percent": None,
            "status": f"not run ({path.name} not found)",
            "validation_level": "structural/schema checks only",
        }
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        return {
            "bundles": 0,
            "valid": 0,
            "percent": None,
            "status": "invalid summary format",
            "validation_level": "structural/schema checks only",
        }

    good_bundles = 0
    good_valid = 0
    broken_bundles = 0
    broken_caught = 0
    total_errors = 0
    total_warnings = 0

    for item in data:
        fname = str(item.get("file", ""))
        errs = int(item.get("errors", 0))
        warns = int(item.get("warnings", 0))
        total_errors += errs
        total_warnings += warns
        is_good = "good-" in fname
        if is_good:
            good_bundles += 1
            if errs == 0:
                good_valid += 1
        else:
            broken_bundles += 1
            if errs > 0:
                broken_caught += 1

    total = len(data)
    all_zero_err = sum(1 for item in data if int(item.get("errors", 0)) == 0)

    try:
        mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    except Exception:
        mtime = None

    return {
        "bundles": total,
        "valid_bundles": all_zero_err,
        "good_bundles": good_bundles,
        "good_valid": good_valid,
        "good_pass_rate": good_valid / good_bundles if good_bundles else None,
        "broken_bundles": broken_bundles,
        "broken_caught": broken_caught,
        "broken_catch_rate": broken_caught / broken_bundles if broken_bundles else None,
        "total_errors": total_errors,
        "total_warnings": total_warnings,
        "validation_level": "HL7 validator 7.0.3 against ABDM FHIR IG ndhm.in 6.5.0 profile & terminology definitions",
        "conformance_disclaimer": "Automated verification against synthetic golden fixtures only; formal ABDM/NRCeS production sandboxing has not been conducted.",
        "source_file": str(path.as_posix()),
        "source_mtime": mtime,
        "provenance_note": "Historical precomputed offline fixture summary from CI (not newly executed during benchmark run)",
    }


# ------------------------------------------------------------------ M-09 Offline safety scoring
def safety_alert_metrics(
    cases: Sequence[dict],
) -> dict[str, object]:
    """Offline precision/recall scoring for expected vs detected safety alert identifiers on synthetic fixtures.

    Each case in cases: {"case_id": str, "expected_alerts": Sequence[str], "detected_alerts": Sequence[str]}
    Uses synthetic test labels only. Does NOT introduce clinical rules or alter the runtime safety engine.
    """
    total_tp = total_fp = total_fn = 0
    per_case: list[dict[str, object]] = []

    for c in cases:
        cid = str(c.get("case_id", "?"))
        exp = set(c.get("expected_alerts") or [])
        det = set(c.get("detected_alerts") or [])
        tp = len(exp & det)
        fp = len(det - exp)
        fn = len(exp - det)
        total_tp += tp
        total_fp += fp
        total_fn += fn
        p = tp / (tp + fp) if tp + fp else 0.0
        r = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * p * r / (p + r) if p + r else 0.0
        per_case.append(
            {
                "case_id": cid,
                "expected": sorted(exp),
                "detected": sorted(det),
                "tp": tp,
                "fp": fp,
                "fn": fn,
                "precision": p,
                "recall": r,
                "f1": f1,
            }
        )

    p_overall = total_tp / (total_tp + total_fp) if total_tp + total_fp else 0.0
    r_overall = total_tp / (total_tp + total_fn) if total_tp + total_fn else 0.0
    f1_overall = 2 * p_overall * r_overall / (p_overall + r_overall) if p_overall + r_overall else 0.0

    return {
        "cases_evaluated": len(cases),
        "total_expected": total_tp + total_fn,
        "total_detected": total_tp + total_fp,
        "overall": {
            "tp": total_tp,
            "fp": total_fp,
            "fn": total_fn,
            "precision": p_overall,
            "recall": r_overall,
            "f1": f1_overall,
        },
        "per_case": per_case,
        "safety_label": "synthetic harness verification only; not clinical safety performance",
        "protocol_note": "Evaluated purely offline on synthetic test fixtures without activating runtime clinical rules.",
    }


# ------------------------------------------------------------------ M-12 time to sign
def time_to_sign(path: Path) -> dict[str, float | int | None]:
    """CSV with `participant,case,condition,seconds` where condition is `system` or `manual`."""
    by: dict[str, list[float]] = defaultdict(list)
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            by[row["condition"].strip().lower()].append(float(row["seconds"]))
    out: dict[str, float | int | None] = {}
    for cond, values in by.items():
        out[f"{cond}_n"] = len(values)
        out[f"{cond}_median_s"] = statistics.median(values)
        out[f"{cond}_mean_s"] = statistics.fmean(values)
    if "system" in by and "manual" in by:
        out["median_saving_s"] = statistics.median(by["manual"]) - statistics.median(by["system"])
    return out


# ------------------------------------------------------------------ M-13 SUS and NASA-TLX
def sus_score(answers: Sequence[int]) -> float:
    """System Usability Scale: ten answers 1..5, odd items positive (answer - 1), even items negative (5 - answer), sum x 2.5."""
    if len(answers) != 10 or any(not 1 <= a <= 5 for a in answers):
        raise ValueError("SUS needs ten answers from 1 to 5")
    total = sum((a - 1) if i % 2 == 0 else (5 - a) for i, a in enumerate(answers))
    return total * 2.5


TLX_SCALES = ("mental", "physical", "temporal", "performance", "effort", "frustration")


def tlx_score(ratings: dict[str, float], weights: dict[str, int] | None = None) -> float:
    """NASA-TLX overall workload 0..100. Raw TLX (no weights) is the mean of the six 0..100 ratings; with the pairwise-comparison
    weights (15 tallies in total) it is the weighted mean."""
    if set(ratings) != set(TLX_SCALES) or any(not 0 <= v <= 100 for v in ratings.values()):
        raise ValueError(f"TLX needs ratings 0..100 for {TLX_SCALES}")
    if weights is None:
        return sum(ratings.values()) / len(TLX_SCALES)
    if set(weights) != set(TLX_SCALES) or sum(weights.values()) != 15:
        raise ValueError("TLX weights must cover the six scales and add up to 15")
    return sum(ratings[s] * weights[s] for s in TLX_SCALES) / 15


def questionnaire_scores(path: Path) -> dict[str, object]:
    """CSV with `participant` plus `sus1..sus10` and/or `mental,physical,temporal,performance,effort,frustration`."""
    sus: list[float] = []
    tlx: list[float] = []
    with path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if all(row.get(f"sus{i}") for i in range(1, 11)):
                sus.append(sus_score([int(row[f"sus{i}"]) for i in range(1, 11)]))
            if all(row.get(s) for s in TLX_SCALES):
                tlx.append(tlx_score({s: float(row[s]) for s in TLX_SCALES}))
    return {
        "sus_n": len(sus),
        "sus_mean": statistics.fmean(sus) if sus else None,
        "sus_min": min(sus) if sus else None,
        "tlx_n": len(tlx),
        "tlx_raw_mean": statistics.fmean(tlx) if tlx else None,
    }


# ------------------------------------------------------------------ inter-annotator agreement
def cohen_kappa(a: Sequence[str], b: Sequence[str]) -> float | None:
    """Cohen's kappa for two annotators' labels on the same items. None when undefined (no items, or both always agree by chance)."""
    if len(a) != len(b):
        raise ValueError("both annotators must label the same items")
    n = len(a)
    if n == 0:
        return None
    observed = sum(1 for x, y in zip(a, b, strict=True) if x == y) / n
    ca, cb = Counter(a), Counter(b)
    expected = sum(ca[k] * cb[k] for k in set(ca) | set(cb)) / (n * n)
    if expected == 1.0:
        return 1.0 if observed == 1.0 else None
    return (observed - expected) / (1 - expected)


def fact_labels(rows: Iterable[dict], key: str = "label") -> dict[tuple[str, str, str], str]:
    """Label per (case, type, quote): `present` | `negated` | `uncertain` | `negated+uncertain`, from annotation CSV rows
    (case_id,type,value,negated,uncertain,evidence_quote,segment)."""
    out = {}
    for r in rows:
        neg = str(r["negated"]).strip().lower() in {"yes", "true", "1"}
        unc = str(r["uncertain"]).strip().lower() in {"yes", "true", "1"}
        label = "+".join(x for x, on in (("negated", neg), ("uncertain", unc)) if on) or "present"
        out[(r["case_id"], r["type"], normalise(r["evidence_quote"]).casefold())] = label
    return out


def agreement(first: Path, second: Path) -> dict[str, float | int | None]:
    """Kappa on the fact labels of two annotation CSVs over the facts BOTH marked (same case, type, quote), plus how many facts
    only one of them marked (a different kind of disagreement, reported as a rate)."""

    def read(p: Path) -> dict[tuple[str, str, str], str]:
        with p.open(newline="", encoding="utf-8") as handle:
            return fact_labels(csv.DictReader(handle))

    a, b = read(first), read(second)
    both = sorted(set(a) & set(b))
    kappa = cohen_kappa([a[k] for k in both], [b[k] for k in both])
    union = len(set(a) | set(b))
    return {
        "shared_facts": len(both),
        "kappa_labels": kappa,
        "only_one_annotator": union - len(both),
        "overlap_rate": len(both) / union if union else None,
    }
