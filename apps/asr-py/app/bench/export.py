"""Result files for a benchmark run (Phase 11A, ADR-D43): CSVs, a Markdown summary, a LaTeX table and the run manifest.

Every table carries the confidence note: the number of cases and "one speaker / acted data". Pathway and red-flag numbers carry
"toy pathways only". Question engines that are not built show "not built" instead of numbers. Only AGGREGATE numbers are written;
no transcript or gold text ever goes into a results file.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path


def confidence_note(n_cases: int, n_audio: int, synthetic: bool) -> str:
    base = (
        f"Confidence note: N = {n_cases} case(s), {n_audio} with audio; one speaker / acted data; "
        "a protocol demonstration, not a result. No confidence interval is claimed."
    )
    if synthetic:
        base += " Synthetic fixtures are included: they only exercise the code."
    return base


def pct(value: float | None, digits: int = 1) -> str:
    return "n/a" if value is None else f"{100 * value:.{digits}f}%"


def _cell_rows(run: dict) -> list[dict]:
    rows = []
    for c in run["cells"]:
        f = c["facts"]
        rows.append(
            {
                "asr": c["asr"],
                "asr_version": c["asr_version"],
                "variant": c["variant"],
                "cases": c["cases"],
                "fact_precision": None if f is None else round(f["overall"]["precision"], 4),
                "fact_recall": None if f is None else round(f["overall"]["recall"], 4),
                "fact_f1": None if f is None else round(f["overall"]["f1"], 4),
                "negation_f1": None if f is None else round(f["negation"]["f1"], 4),
                "hallucination_rate": None if f is None else round(f["hallucination"]["rate"], 4),
                "wer": None if c["wer"] is None else round(c["wer"]["rate"], 4),
                "cer": None if c["cer"] is None else round(c["cer"]["rate"], 4),
                "medicine_accuracy": None
                if not c["medicine"]
                else round(c["medicine"]["accuracy"], 4),
            }
        )
    return rows


def _question_rows(run: dict) -> list[dict]:
    rows = []
    for q in run["questions"]:
        p, r = q.get("pathway") or {}, q.get("red_flag") or {}
        rows.append(
            {
                "question_engine": q["engine"],
                "status": q["status"],
                "pathways": q["pathways"],
                "n": p.get("n"),
                "top1": p.get("top1"),
                "top3": p.get("top3"),
                "median_questions_to_top3": p.get("median_questions_to_top3"),
                "red_flag_seeded": r.get("seeded"),
                "red_flag_recall": r.get("recall"),
            }
        )
    return rows


def _csv(path: Path, rows: list[dict], fieldnames: list[str] | None = None) -> None:
    fields = fieldnames or (list(rows[0]) if rows else [])
    if not fields:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def tex_escape(text: str) -> str:
    for a, b in (
        ("\\", "\\textbackslash{}"),
        ("&", "\\&"),
        ("%", "\\%"),
        ("_", "\\_"),
        ("#", "\\#"),
        ("$", "\\$"),
    ):
        text = text.replace(a, b)
    return text


def latex_table(run: dict) -> str:
    head = [
        "ASR",
        "Variant",
        "N",
        "Fact P",
        "Fact R",
        "Fact F1",
        "Neg. F1",
        "Halluc.",
        "WER",
        "CER",
    ]
    lines = [
        "\\begin{tabular}{llrrrrrrrr}",
        "\\hline",
        " & ".join(f"\\textbf{{{h}}}" for h in head) + " \\\\",
        "\\hline",
    ]
    for r in _cell_rows(run):
        cells = [
            tex_escape(str(r["asr"])),
            tex_escape(str(r["variant"])),
            str(r["cases"]),
            *(
                pct(r[k])
                for k in (
                    "fact_precision",
                    "fact_recall",
                    "fact_f1",
                    "negation_f1",
                    "hallucination_rate",
                    "wer",
                    "cer",
                )
            ),
        ]
        lines.append(" & ".join(tex_escape(c) if "%" in c else c for c in cells) + " \\\\")
    lines += ["\\hline", "\\end{tabular}", "", "% " + run["note"].replace("\n", " ")]
    caption = tex_escape(run["note"])
    lines.append(f"\\par\\footnotesize {caption}")
    return "\n".join(lines) + "\n"


def summary_md(run: dict) -> str:
    m = run["manifest"]
    out = [
        "# Benchmark run summary",
        "",
        f"Run at {m['run_at']}, split `{m['split']}`, dataset hash `{m['dataset_hash'][:12]}`, "
        f"split hash `{(m['split_hash'] or 'none')[:12]}`, language model `{m['llm']['model']}` ({m['llm']['provider']}).",
        "",
        "## ASR x extraction",
        "",
        "| ASR | Variant | N | Fact P | Fact R | Fact F1 | Negation F1 | Hallucination | WER | CER | Medicine acc. |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in _cell_rows(run):
        out.append(
            f"| {r['asr']} | {r['variant']} | {r['cases']} | {pct(r['fact_precision'])} | {pct(r['fact_recall'])} | "
            f"{pct(r['fact_f1'])} | {pct(r['negation_f1'])} | {pct(r['hallucination_rate'])} | {pct(r['wer'])} | "
            f"{pct(r['cer'])} | {pct(r['medicine_accuracy'])} |"
        )
    out += ["", run["note"], "", "## Question engines (TOY pathways only)", ""]
    out += [
        "| Engine | Status | N | Top-1 | Top-3 | Median questions to top-3 | Red flags seeded | Red-flag recall |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for q in _question_rows(run):
        out.append(
            f"| {q['question_engine']} | {q['status']} | {q['n'] if q['n'] is not None else '-'} | {pct(q['top1'])} | "
            f"{pct(q['top3'])} | {q['median_questions_to_top3'] if q['median_questions_to_top3'] is not None else 'n/a'} | "
            f"{q['red_flag_seeded'] if q['red_flag_seeded'] is not None else '-'} | {pct(q['red_flag_recall'])} |"
        )
    out += [
        "",
        "These question-engine numbers come from FAKE toy pathways and say nothing about real conditions. "
        "`llm-only` and `hybrid` are not built. " + run["note"],
    ]

    error_rows = run.get("error_rows", [])
    if error_rows:
        counts = {}
        for row in error_rows:
            cat = row.get("error_category", "unknown")
            counts[cat] = counts.get(cat, 0) + 1
        out += [
            "",
            "## Fact Extraction Error Taxonomy",
            "",
            f"Total extraction discrepancies: {len(error_rows)} across evaluated variants. (See `errors.csv` for itemized cases).",
            "",
            "| Error Category | Discrepancies | Taxonomy Meaning |",
            "|---|---|---|",
        ]
        descriptions = {
            "missed_fact": "Gold fact not extracted by prediction (False Negative)",
            "unsupported_fact": "Predicted quote missing or not verbatim in transcript (Hallucination)",
            "negation_mismatch": "Evidence matched, but assertion polarity was inverted",
            "type_mismatch": "Evidence matched, but fact was categorized under the wrong clinical slot",
            "span_misalignment": "Same fact type, but evidence quote overlap was below threshold (< 0.6)",
            "duplicate_prediction": "Multiple distinct predictions claiming the same gold evidence span",
            "unmatched_prediction": "Predicted fact grounded in transcript but absent from gold standard",
        }
        for cat in sorted(counts):
            out.append(f"| `{cat}` | {counts[cat]} | {descriptions.get(cat, 'Unclassified')} |")

    asr_langs = run.get("manifest", {}).get("asr_languages")
    if asr_langs and isinstance(asr_langs, dict):
        out += [
            "",
            "## ASR Performance by Explicit Language Annotation",
            "",
            "| Language Group | Segments | Reference Words | Word Errors | Segment WER | Reference Chars | Char Errors | Segment CER |",
            "|---|---|---|---|---|---|---|---|",
        ]
        by_lang = asr_langs.get("by_language", {})
        for lang, stats in sorted(by_lang.items()):
            out.append(
                f"| `{lang}` | {stats.get('segments', 0)} | {stats.get('reference_words', 0)} | "
                f"{stats.get('word_errors', 0)} | {pct(stats.get('wer'))} | {stats.get('reference_chars', 0)} | "
                f"{stats.get('char_errors', 0)} | {pct(stats.get('cer'))} |"
            )
        mixed = asr_langs.get("mixed_segments", {})
        if mixed.get("segments", 0) > 0:
            out.append(
                f"| `mixed` (code-switch) | {mixed.get('segments', 0)} | {mixed.get('reference_words', 0)} | "
                f"{mixed.get('word_errors', 0)} | {pct(mixed.get('wer'))} | {mixed.get('reference_chars', 0)} | "
                f"{mixed.get('char_errors', 0)} | {pct(mixed.get('cer'))} |"
            )
        unann = asr_langs.get("unannotated_segments", {})
        if unann.get("segments", 0) > 0:
            out.append(
                f"| `unannotated` | {unann.get('segments', 0)} | {unann.get('reference_words', 0)} | "
                f"{unann.get('word_errors', 0)} | {pct(unann.get('wer'))} | {unann.get('reference_chars', 0)} | "
                f"{unann.get('char_errors', 0)} | {pct(unann.get('cer'))} |"
            )
        out += ["", f"> {asr_langs.get('protocol_note', '')}"]

    if run.get("extras"):
        out += ["", "## Additional Verification Inputs", ""]
        for key, value in run["extras"].items():
            if key == "fhir_validity" and isinstance(value, dict):
                out += [
                    "- **FHIR Validation (M-11)**:",
                    f"  - Validation Level: {value.get('validation_level', 'Structural check')}",
                    f"  - Source: `{value.get('source_file', 'unknown')}` (last modified: {value.get('source_mtime', 'unknown')})",
                    f"  - Provenance: {value.get('provenance_note', 'Historical fixture summary')}",
                    f"  - Total Bundles: {value.get('bundles', 0)} (Good: {value.get('good_bundles', 0)}, Broken: {value.get('broken_bundles', 0)})",
                    f"  - Good Bundle Pass Rate: {pct(value.get('good_pass_rate'))}",
                    f"  - Broken Bundle Catch Rate: {pct(value.get('broken_catch_rate'))}",
                    f"  - Disclaimer: {value.get('conformance_disclaimer', 'Synthetic golden fixtures only.')}",
                ]
            elif key == "safety_scoring" and isinstance(value, dict):
                ov = value.get("overall", {})
                out += [
                    "- **Offline Safety Alert Verification (M-09)**:",
                    f"  - Label: `{value.get('safety_label')}`",
                    f"  - Cases Evaluated: {value.get('cases_evaluated', 0)}",
                    f"  - Precision: {pct(ov.get('precision'))} | Recall: {pct(ov.get('recall'))} | F1: {pct(ov.get('f1'))}",
                    f"  - Note: {value.get('protocol_note', '')}",
                ]
            else:
                out.append(f"- **{key}**: `{json.dumps(value, ensure_ascii=False)}`")
        out += ["", run["note"]]
    out += [
        "",
        "## Reproduce",
        "",
        "Rerun the same command: every stage result is cached by engine + version + prompt hash + input hash, so a rerun costs nothing.",
    ]
    return "\n".join(out) + "\n"


ERROR_CSV_HEADERS = [
    "case_id",
    "error_category",
    "gold_type",
    "predicted_type",
    "gold_quote",
    "predicted_quote",
    "detail",
]


def write_outputs(folder: Path, run: dict) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "manifest.json").write_text(
        json.dumps(run["manifest"], indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    _csv(folder / "cells.csv", _cell_rows(run))
    _csv(folder / "cases.csv", run["case_rows"])
    _csv(folder / "questions.csv", _question_rows(run))
    _csv(folder / "errors.csv", run.get("error_rows", []), ERROR_CSV_HEADERS)
    (folder / "summary.md").write_text(summary_md(run), encoding="utf-8")
    (folder / "table.tex").write_text(latex_table(run), encoding="utf-8")
