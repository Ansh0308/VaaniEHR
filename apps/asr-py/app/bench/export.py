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


def _csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
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
    if run["extras"]:
        out += ["", "## Other inputs", ""]
        for key, value in run["extras"].items():
            out.append(f"- **{key}**: `{json.dumps(value, ensure_ascii=False)}`")
        out += ["", run["note"]]
    out += [
        "",
        "## Reproduce",
        "",
        "Rerun the same command: every stage result is cached by engine + version + prompt hash + input hash, so a rerun costs nothing.",
    ]
    return "\n".join(out) + "\n"


def write_outputs(folder: Path, run: dict) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "manifest.json").write_text(
        json.dumps(run["manifest"], indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    _csv(folder / "cells.csv", _cell_rows(run))
    _csv(folder / "cases.csv", run["case_rows"])
    _csv(folder / "questions.csv", _question_rows(run))
    (folder / "summary.md").write_text(summary_md(run), encoding="utf-8")
    (folder / "table.tex").write_text(latex_table(run), encoding="utf-8")
