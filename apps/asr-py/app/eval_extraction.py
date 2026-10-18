"""Evaluation of fact extraction against gold labels (PRD 14.3 experiment 2, M-02/M-03 style numbers).

  python -m app.eval_extraction [--texts audio/own] [--gold-md audio/own/READ_ALOUD_AND_GOLD.md] [--gold-dir DIR]
                                [--fixtures tests/fixtures/extraction] [--pipeline plain|constrained|grounded|all]

Text-only: each clip is a .txt with one sentence per line (one line = one segment, labels s1, s2, ...). Gold comes from the
tables in READ_ALOUD_AND_GOLD.md (type | value | negated | uncertain | evidence quote) or from JSON files (see
docs/EXTRACTION_EVAL_GUIDE.md). A predicted fact MATCHES a gold fact when the type is the same and the evidence quotes
overlap (one contains the other, or similarity >= 0.6) on the same line; matching is one-to-one. Reported: precision,
recall and F1 per fact type and overall (micro), NEGATION F1 separately (positive class = negated), and the number of
facts dropped as ungrounded (the hallucination count). Every run records the model id, the run date and the prompt
version/hash. Results go to data/asr/eval-extraction/ (git-ignored); only AGGREGATE numbers may be copied into docs.
The provider is the mock unless LLM_PROVIDER says otherwise. With a real provider only text declared simulated is
sent (app/simulated_text.py) and only with --yes-run; without it the command prints the plan and stops.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from difflib import SequenceMatcher
from pathlib import Path

from app.config import REPO_ROOT, load_settings
from app.extraction.llm_usage import LlmSpendGuard, LlmUsageLog
from app.extraction.models import FACT_TYPES
from app.extraction.pipelines import (
    PROMPT_VERSION,
    PipelineResult,
    SegmentIn,
    prompt_hash,
    run_pipeline,
)
from app.extraction.provider import LlmProvider, MockProvider, ProviderError, build_provider
from app.extraction.run import log_run
from app.extraction.text import normalise
from app.simulated_text import NotSimulatedRefused, verify_simulated_text
from app.usage import CapExceeded

OVERLAP = 0.6


@dataclass
class GoldFact:
    type: str
    value: str
    negated: bool
    uncertain: bool
    quote: str
    line: int | None = None  # index of the line the quote was found in


@dataclass
class Case:
    id: str
    lines: list[str]
    gold: list[GoldFact]
    synthetic: bool = False
    mock_output: str | None = None
    notes: list[str] = field(default_factory=list)


# ------------------------------------------------------------------ reading cases
def locate(gold: list[GoldFact], lines: list[str]) -> list[str]:
    """Finds the line of every gold quote. Returns problems (a quote that is in no line, or in more than one)."""
    problems = []
    normalised = [normalise(line) for line in lines]
    for g in gold:
        hits = [i for i, line in enumerate(normalised) if normalise(g.quote) in line]
        if len(hits) != 1:
            problems.append(
                f"quote {g.quote!r} is in {len(hits)} lines (it must be in exactly one)"
            )
        else:
            g.line = hits[0]
    return problems


def parse_gold_md(markdown: str) -> dict[str, list[GoldFact]]:
    """Reads the `## clipNN` sections and their tables from READ_ALOUD_AND_GOLD.md."""
    out: dict[str, list[GoldFact]] = {}
    current: str | None = None
    for line in markdown.splitlines():
        heading = re.match(r"^##\s+(clip\d+)", line)
        if heading:
            current = heading.group(1)
            out[current] = []
            continue
        if current and line.startswith("|"):
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) == 5 and cells[0] in FACT_TYPES:
                out[current].append(
                    GoldFact(
                        cells[0],
                        cells[1],
                        cells[2].lower() == "yes",
                        cells[3].lower() == "yes",
                        cells[4],
                    )
                )
    return out


def load_cases(
    texts: Path | None, gold_md: Path | None, gold_dir: Path | None, fixtures: Path | None
) -> list[Case]:
    cases: list[Case] = []
    gold_all = (
        parse_gold_md(gold_md.read_text(encoding="utf-8")) if gold_md and gold_md.exists() else {}
    )
    if texts and texts.exists():
        for txt in sorted(texts.glob("clip*.txt")):
            lines = [ln for ln in txt.read_text(encoding="utf-8").splitlines() if ln.strip()]
            gold: list[GoldFact] | None = gold_all.get(txt.stem)
            if gold_dir and (gold_dir / f"{txt.stem}.json").exists():
                data = json.loads((gold_dir / f"{txt.stem}.json").read_text(encoding="utf-8"))
                gold = [
                    GoldFact(
                        f["type"],
                        f.get("value", ""),
                        bool(f["negated"]),
                        bool(f["uncertain"]),
                        f["evidence_quote"],
                    )
                    for f in data["facts"]
                ]
            if gold is None:
                continue  # no gold labels for this clip: it cannot be scored
            cases.append(Case(txt.stem, lines, gold))
    if fixtures and fixtures.exists():
        for path in sorted(fixtures.glob("synthetic*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            gold = [
                GoldFact(
                    f["type"],
                    f.get("value", ""),
                    bool(f["negated"]),
                    bool(f["uncertain"]),
                    f["evidence_quote"],
                )
                for f in data["facts"]
            ]
            cases.append(
                Case(
                    data["id"],
                    data["lines"],
                    gold,
                    bool(data.get("synthetic")),
                    json.dumps(data.get("mock_output")),
                )
            )
    for case in cases:
        case.notes = locate(case.gold, case.lines)
    return cases


# ------------------------------------------------------------------ scoring
@dataclass
class Counts:
    tp: int = 0
    fp: int = 0
    fn: int = 0

    @property
    def precision(self) -> float:
        return self.tp / (self.tp + self.fp) if self.tp + self.fp else 0.0

    @property
    def recall(self) -> float:
        return self.tp / (self.tp + self.fn) if self.tp + self.fn else 0.0

    @property
    def f1(self) -> float:
        p, r = self.precision, self.recall
        return 2 * p * r / (p + r) if p + r else 0.0


def overlap(a: str, b: str) -> float:
    x, y = normalise(a).casefold(), normalise(b).casefold()
    if not x or not y:
        return 0.0
    if x in y or y in x:
        return 1.0
    return SequenceMatcher(None, x, y, autojunk=False).ratio()


def score(
    case: Case, result: PipelineResult, per_type: dict[str, Counts], negation: Counts
) -> None:
    """Adds one case to the counts. Greedy one-to-one matching by highest overlap."""
    predicted = result.predicted
    pairs = []
    for pi, p in enumerate(predicted):
        p_line = (
            int(p.segment_label[1:]) - 1
            if p.segment_label and re.fullmatch(r"s\d+", p.segment_label)
            else None
        )
        for gi, g in enumerate(case.gold):
            if p.type == g.type and (p_line is None or g.line is None or p_line == g.line):
                o = overlap(p.evidence_quote, g.quote)
                if o >= OVERLAP:
                    pairs.append((o, pi, gi))
    used_p: set[int] = set()
    used_g: set[int] = set()
    for _o, pi, gi in sorted(pairs, reverse=True):
        if pi in used_p or gi in used_g:
            continue
        used_p.add(pi)
        used_g.add(gi)
        p, g = predicted[pi], case.gold[gi]
        per_type[g.type].tp += 1
        if g.negated and p.negated:
            negation.tp += 1
        elif p.negated and not g.negated:
            negation.fp += 1
        elif g.negated and not p.negated:
            negation.fn += 1
    for pi, p in enumerate(predicted):
        if pi not in used_p:
            per_type[p.type if p.type in FACT_TYPES else "other"].fp += 1
            if p.negated:
                negation.fp += 1
    for gi, g in enumerate(case.gold):
        if gi not in used_g:
            per_type[g.type].fn += 1
            if g.negated:
                negation.fn += 1


# ------------------------------------------------------------------ running
async def evaluate(
    cases: list[Case], pipeline: str, provider_for: callable, usage: LlmUsageLog | None
) -> tuple[dict[str, Counts], Counts, dict[str, int]]:
    per_type: dict[str, Counts] = defaultdict(Counts)
    negation = Counts()
    totals = {"ungrounded": 0, "invalid": 0, "schema_failures": 0, "predicted": 0, "gold": 0}
    for case in cases:
        segments = [
            SegmentIn(f"{case.id}-{i}", i, "unknown", line) for i, line in enumerate(case.lines)
        ]
        provider: LlmProvider = provider_for(case)
        before = getattr(provider, "requests_made", 0)
        result = await run_pipeline(pipeline, provider, segments)  # type: ignore[arg-type]
        score(case, result, per_type, negation)
        totals["ungrounded"] += result.dropped_ungrounded
        totals["invalid"] += result.dropped_invalid
        totals["schema_failures"] += result.schema_failures
        totals["predicted"] += len(result.predicted)
        totals["gold"] += len(case.gold)
        if usage:
            sent = getattr(provider, "requests_made", 0) - before
            log_run(usage, provider, result, f"eval-{case.id}", "eval", None, sent)
    return per_type, negation, totals


def write_results(
    folder: Path,
    pipeline: str,
    model: str,
    per_type: dict[str, Counts],
    negation: Counts,
    totals: dict[str, int],
    cases: list[Case],
) -> str:
    folder.mkdir(parents=True, exist_ok=True)
    overall = Counts(
        sum(c.tp for c in per_type.values()),
        sum(c.fp for c in per_type.values()),
        sum(c.fn for c in per_type.values()),
    )
    rows = [(t, per_type[t]) for t in [*FACT_TYPES, "other"] if t in per_type] + [
        ("OVERALL", overall),
        ("NEGATION", negation),
    ]
    with (folder / "results.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["type", "tp", "fp", "fn", "precision", "recall", "f1"])
        for name, c in rows:
            writer.writerow(
                [name, c.tp, c.fp, c.fn, round(c.precision, 3), round(c.recall, 3), round(c.f1, 3)]
            )
    now = datetime.now(UTC)
    meta = {"pipeline": pipeline, "model": model, "run_date": now.date().isoformat(), "prompt_version": PROMPT_VERSION,
            "prompt_hash": prompt_hash(), "cases": len(cases), "synthetic_cases": sum(c.synthetic for c in cases), **totals}  # fmt: skip
    (folder / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    md = [f"Extraction evaluation: pipeline `{pipeline}`, model `{model}`, run {meta['run_date']}, prompt `{PROMPT_VERSION}`, {len(cases)} cases "
          f"({meta['synthetic_cases']} synthetic), {totals['gold']} gold facts, {totals['predicted']} predicted, "
          f"{totals['ungrounded']} dropped as ungrounded.", "",
          "| type | TP | FP | FN | precision | recall | F1 |", "| --- | --- | --- | --- | --- | --- | --- |"]  # fmt: skip
    md += [
        f"| {n} | {c.tp} | {c.fp} | {c.fn} | {c.precision:.2f} | {c.recall:.2f} | {c.f1:.2f} |"
        for n, c in rows
    ]
    text = "\n".join(md) + "\n"
    (folder / "results.md").write_text(text, encoding="utf-8")
    return text


def main(argv: list[str], out=print) -> int:  # noqa: ANN001
    parser = argparse.ArgumentParser(prog="python -m app.eval_extraction")
    parser.add_argument("--texts", default=str(REPO_ROOT / "audio" / "own"))
    parser.add_argument(
        "--gold-md", default=str(REPO_ROOT / "audio" / "own" / "READ_ALOUD_AND_GOLD.md")
    )
    parser.add_argument("--gold-dir")
    parser.add_argument("--fixtures")
    parser.add_argument(
        "--pipeline", default="grounded", choices=["plain", "constrained", "grounded", "all"]
    )
    parser.add_argument("--out-dir")
    parser.add_argument(
        "--yes-run",
        action="store_true",
        help="call a real model (otherwise only the plan is shown)",
    )
    args = parser.parse_args(argv)
    settings = load_settings()
    cases = load_cases(Path(args.texts) if args.texts else None, Path(args.gold_md), Path(args.gold_dir) if args.gold_dir else None,
                       Path(args.fixtures) if args.fixtures else None)  # fmt: skip
    if not cases:
        out("no cases with gold labels found")
        return 2
    problems = [f"{c.id}: {n}" for c in cases for n in c.notes]
    if problems:
        out("gold problems:\n  " + "\n  ".join(problems))
        return 2
    env = {**os.environ}
    if env.get("LLM_PROVIDER", "mock") != "mock":
        # a hosted model may log prompts: only declared-simulated text, and only on an explicit --yes-run.
        # This check replaces LLM_ALLOW_REAL_DATA for the evaluation (that switch still guards the live consult path).
        try:
            for case in cases:
                if not case.synthetic:
                    verify_simulated_text(Path(args.texts) / f"{case.id}.txt", Path(args.texts))
        except NotSimulatedRefused as exc:
            out(f"refused: {exc}")
            return 2
        env["LLM_ALLOW_REAL_DATA"] = "true"
    try:
        base = build_provider(env, settings.llm_cache_dir)
    except ProviderError as exc:
        out(f"language model not available: {exc}")
        return 2
    if base.name != "mock":
        names = ["plain", "constrained", "grounded"] if args.pipeline == "all" else [args.pipeline]
        planned = len(cases) * len(names)
        out(
            f"plan: model {base.model}, {len(cases)} cases x {len(names)} pipeline(s) = "
            f"up to {planned} requests (run cap {settings.llm_request_cap})"
        )
        if not args.yes_run:
            out("nothing was sent; add --yes-run to run it")
            return 0
        if planned > settings.llm_request_cap:
            out(
                "the plan is above the per-run request cap; raise LLM_REQUEST_CAP or run fewer pipelines"
            )
            return 2
        try:
            LlmSpendGuard(
                LlmUsageLog(settings.llm_usage_log_path),
                settings.llm_monthly_cap_inr,
                settings.llm_monthly_cap_tokens,
                settings.llm_monthly_cap_requests,
            ).check(base.paid, 0, planned)
        except CapExceeded as exc:
            out(f"refused: {exc}")
            return 2

    def provider_for(case: Case) -> LlmProvider:
        # a fixture carries the canned reply a model would give; real clips use whatever provider is configured
        return (
            MockProvider(case.mock_output, model=base.model)
            if case.mock_output is not None and base.name == "mock"
            else base
        )

    usage = LlmUsageLog(
        settings.llm_usage_log_path,
        input_inr_per_million=settings.llm_input_inr_per_million,
        output_inr_per_million=settings.llm_output_inr_per_million,
    )
    pipelines = ["plain", "constrained", "grounded"] if args.pipeline == "all" else [args.pipeline]
    for pipeline in pipelines:
        per_type, negation, totals = asyncio.run(evaluate(cases, pipeline, provider_for, usage))
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
        folder = (
            Path(args.out_dir)
            if args.out_dir
            else settings.data_dir
            / "eval-extraction"
            / f"{stamp}-{pipeline}-{base.model.replace('/', '_')}"
        )
        out(write_results(folder, pipeline, base.model, per_type, negation, totals, cases).rstrip())
        out(f"details (private): {folder}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
