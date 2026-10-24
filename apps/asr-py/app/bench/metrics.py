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
import statistics
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

from app.eval_extraction import Case, Counts, GoldFact, locate, score
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
