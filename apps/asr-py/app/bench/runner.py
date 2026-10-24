"""Batch benchmark runner (Phase 11A, ADR-D43).

  python -m app.bench.runner [--split dev|test|all] [--asr gold,mock] [--variants plain,constrained,grounded]
                             [--questions rules-only,llm-only,hybrid] [--fixtures] [--yes-run] [--out-dir DIR]

Grid: {ASR engine} x {extraction variant} x {question engine}. "gold" as the ASR engine means the gold transcript is the text (no
audio needed). The question engines `llm-only` and `hybrid` are NOT BUILT and are reported as such; `rules-only` runs the real
rules engine on the fake TOY pathways only (labelled toy everywhere).

Cost control: every stage result is cached under data/bench/cache keyed by engine + version + prompt hash + input hash, so a
rerun costs nothing and gives the same numbers (`npm run bench:run` again = reproduce from cache). Nothing paid or hosted starts
without --yes-run, and then only through the existing guards: the monthly caps (SpendGuard / LlmSpendGuard), the per-run request
cap, the own-voice rule for paid audio and the simulated-text rule for hosted language models. Existing tools (eval:asr,
eval:extraction, usage:asr) are reused, not replaced: this module calls their building blocks.

Test split: before any evaluation that includes a test case the frozen split is checked (app.bench.split); any sign of tuning
(edited prompt, new model or engine, changed threshold, edited or removed test case) refuses the run.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from app.bench import export, metrics
from app.bench.cache import Cache, digest
from app.bench.dataset import BENCH_ROOT, DATA_ROOT, dataset_hash, load_cases
from app.bench.split import VARIANTS, check_frozen, load_split, split_hash, tuning_state
from app.config import REPO_ROOT, Settings, load_settings
from app.eval_extraction import GoldFact
from app.extraction.llm_usage import LlmSpendGuard, LlmUsageLog
from app.extraction.pipelines import SegmentIn, prompt_hash_of, run_pipeline
from app.extraction.provider import LlmProvider, MockProvider, ProviderError, build_provider
from app.extraction.run import log_run
from app.own_voice import OWN_DIR, ThirdPartyAudioRefused, verify_own_voice
from app.simulated_text import NotSimulatedRefused, verify_simulated_text
from app.smoke import EngineFactory, _run_once, default_engine, load_wav_16k_mono
from app.usage import PAID_ENGINES, CapExceeded, SpendGuard, UsageLog
from app.wer import script_share

QUESTION_ENGINES = ("rules-only", "llm-only", "hybrid")
NOT_BUILT = {"llm-only": "not built", "hybrid": "not built"}
TOY_PATHWAYS = REPO_ROOT / "packages" / "rules" / "fixtures" / "pathways" / "_toy"
RULES_SCRIPT = REPO_ROOT / "scripts" / "bench-rules.mjs"

RulesRunner = Callable[[list[dict], Path], dict]


class Refused(Exception):
    """The run must not start; the message says why and how to fix it."""

    def __init__(self, message: str, code: int = 2) -> None:
        super().__init__(message)
        self.code = code


@dataclass
class Options:
    cases_dir: Path = DATA_ROOT / "cases"
    audio_root: Path = DATA_ROOT
    fixtures: bool = False
    split: str = "dev"
    split_file: Path = DATA_ROOT / "split.json"
    asr: list[str] = field(default_factory=lambda: ["gold"])
    variants: list[str] = field(default_factory=lambda: list(VARIANTS))
    questions: list[str] = field(default_factory=lambda: list(QUESTION_ENGINES))
    yes_run: bool = False
    out_dir: Path | None = None
    cache_dir: Path = DATA_ROOT / "cache"
    pathway_dir: Path = TOY_PATHWAYS
    mode: str = "codemix"
    fhir_csv: Path | None = None
    time_csv: Path | None = None
    questionnaire_csv: Path | None = None
    own_dir: Path = OWN_DIR


@dataclass
class Deps:
    settings: Settings
    factory: EngineFactory = default_engine
    provider: LlmProvider | None = None
    rules: RulesRunner | None = None
    out: Callable[[str], None] = print
    now: Callable[[], datetime] = lambda: datetime.now(UTC)


# ------------------------------------------------------------------ the rules-only question engine (toy)
def run_rules_script(cases: list[dict], pathway_dir: Path) -> dict:
    """Runs scripts/bench-rules.mjs (the real rules engine on the toy pathways) on the cases' oracle answers."""
    payload = [
        {
            "id": c["id"],
            "condition_label": c.get("condition_label"),
            "oracle_slots": c.get("oracle_slots", {}),
        }
        for c in cases
    ]
    done = subprocess.run(  # noqa: S603
        ["node", "--import", "tsx", str(RULES_SCRIPT), str(pathway_dir)],  # noqa: S607
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
        timeout=120,
        check=False,
    )
    if done.returncode != 0:
        raise Refused(f"the rules simulation failed: {done.stderr.strip()[-300:]}", 1)
    return json.loads(done.stdout)


# ------------------------------------------------------------------ helpers
def _git_commit() -> str | None:
    try:
        done = subprocess.run(  # noqa: S603
            ["git", "rev-parse", "HEAD"],  # noqa: S607
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
            timeout=10,
            check=False,
        )
        return done.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def gold_lines(case: dict) -> list[str]:
    return [s["text"] for s in case["transcript"]["segments"]]


def gold_facts(case: dict) -> list[GoldFact]:
    return [
        GoldFact(f["type"], f["value"], f["negated"], f["uncertain"], f["evidence_quote"])
        for f in case["gold_facts"]
    ]


def select_cases(opts: Options) -> tuple[list[dict], list[dict], dict | None]:
    """(cases to evaluate, every real case, the split or None)."""
    everything = load_cases(opts.cases_dir) if opts.cases_dir.exists() else []
    synthetic = load_cases(BENCH_ROOT / "fixtures") if opts.fixtures else []
    split = load_split(opts.split_file) if opts.split_file.exists() else None
    if opts.split in ("dev", "test"):
        if split is None:
            raise Refused(
                f"no frozen split at {opts.split_file}: run `npm run bench:split -- freeze` first (or use --split all)"
            )
        wanted = set(split[opts.split])
        chosen = [c for c in everything if c["id"] in wanted]
    else:
        chosen = list(everything)
    return chosen + synthetic, everything, split


def models_in_use(opts: Options, provider: LlmProvider) -> list[str]:
    return [*opts.asr, provider.model]


# ------------------------------------------------------------------ ASR stage
def transcribe(
    case: dict,
    engine_name: str,
    opts: Options,
    deps: Deps,
    cache: Cache,
    spend: SpendGuard | None,
    planned: list,
) -> dict | None:
    """Hypothesis for one case with one engine, from the cache or (when allowed) a real run. None = no audio / not allowed."""
    audio = case["audio"]
    if not audio.get("file") or not audio.get("sha256"):
        return None
    wav = opts.audio_root / audio["file"]
    if not wav.exists():
        return None
    settings = deps.settings
    engine = deps.factory(
        engine_name,
        settings,
        spend
        or SpendGuard(
            UsageLog(settings.usage_log_path),
            settings.monthly_cap_minutes,
            settings.smoke_max_seconds,
        ),
        True,
        [],
        mode=opts.mode,
    )
    key = cache.key(
        "asr", engine=engine.name, version=engine.version, audio=audio["sha256"], mode=opts.mode
    )
    hit = cache.get(key)
    if hit is not None:
        return hit
    paid = engine_name in PAID_ENGINES
    if paid and not opts.yes_run:
        planned.append((case["id"], engine_name))
        return {"pending": True}
    pcm, _duration = load_wav_16k_mono(wav, settings.smoke_max_seconds)
    seconds = len(pcm) / 32000
    if paid:
        if not settings.allow_third_party_audio:
            try:
                verify_own_voice(opts.own_dir / f"{case['id']}.wav", opts.own_dir)
            except (ThirdPartyAudioRefused, OSError) as exc:
                raise Refused(
                    f"{case['id']}: paid audio must be the owner's own voice ({type(exc).__name__})"
                ) from exc
        usage = UsageLog(settings.usage_log_path)
        guard = spend or SpendGuard(usage, settings.monthly_cap_minutes, settings.smoke_max_seconds)
        try:
            guard.check(engine_name, seconds, "stream")
        except CapExceeded as exc:
            raise Refused(f"refused: {exc}", 3) from exc
    segments, _first, _took = asyncio.run(_run_once(engine, pcm, "gu-IN", []))
    result = {
        "engine": engine.name,
        "version": engine.version,
        "lines": [s.text for s in segments],
        "seconds": round(seconds, 1),
    }
    cache.put(key, result)
    return result


# ------------------------------------------------------------------ extraction stage
def extract(
    case: dict,
    lines: list[str],
    variant: str,
    provider: LlmProvider,
    cache: Cache,
    opts: Options,
    deps: Deps,
    planned: list,
) -> dict | None:
    canned = case.get("mock_output") if provider.name == "mock" else None
    use = MockProvider(json.dumps(canned), model=provider.model) if canned is not None else provider
    key = cache.key(
        "extract",
        provider=use.name,
        model=use.model,
        variant=variant,
        prompt=prompt_hash_of(variant),
        text=digest(lines),
        canned=digest(canned) if canned is not None else None,
    )
    hit = cache.get(key)
    if hit is not None:
        return hit
    if use.name != "mock" and not opts.yes_run:
        planned.append((case["id"], variant))
        return None
    segments = [SegmentIn(f"{case['id']}-{i}", i, "unknown", line) for i, line in enumerate(lines)]
    before = getattr(use, "requests_made", 0)
    result = asyncio.run(run_pipeline(variant, use, segments))  # type: ignore[arg-type]
    record = {
        "predicted": [p.model_dump() for p in result.predicted],
        "dropped_ungrounded": result.dropped_ungrounded,
        "dropped_invalid": result.dropped_invalid,
        "schema_failures": result.schema_failures,
        "invalid_json": result.invalid_json,
        "model": use.model,
    }
    cache.put(key, record)
    if use.name != "mock":
        usage = LlmUsageLog(
            deps.settings.llm_usage_log_path,
            input_inr_per_million=deps.settings.llm_input_inr_per_million,
            output_inr_per_million=deps.settings.llm_output_inr_per_million,
        )
        log_run(
            usage,
            use,
            result,
            f"bench-{case['id']}",
            "eval",
            None,
            getattr(use, "requests_made", 0) - before,
        )
    return record


def check_hosted_model(
    cases: list[dict], provider: LlmProvider, opts: Options, deps: Deps, to_send: int
) -> None:
    """The same rules eval:extraction applies before text goes to a hosted model."""
    if provider.name == "mock":
        return
    for case in cases:
        if not case.get("synthetic"):
            try:
                verify_simulated_text(opts.own_dir / f"{case['id']}.txt", opts.own_dir)
            except NotSimulatedRefused as exc:
                raise Refused(f"refused: {exc}") from exc
    if not opts.yes_run:
        return
    s = deps.settings
    if to_send > s.llm_request_cap:
        raise Refused(
            "the plan is above the per-run request cap; raise LLM_REQUEST_CAP or run fewer variants"
        )
    try:
        LlmSpendGuard(
            LlmUsageLog(s.llm_usage_log_path),
            s.llm_monthly_cap_inr,
            s.llm_monthly_cap_tokens,
            s.llm_monthly_cap_requests,
        ).check(provider.paid, 0, to_send)
    except CapExceeded as exc:
        raise Refused(f"refused: {exc}", 3) from exc


# ------------------------------------------------------------------ the run
def execute(opts: Options, deps: Deps) -> dict:
    """Runs the grid and returns the run record (see export.py). Raises Refused when the run must not start."""
    for v in opts.variants:
        if v not in VARIANTS:
            raise Refused(f"unknown variant '{v}' (plain, constrained, grounded)")
    for q in opts.questions:
        if q not in QUESTION_ENGINES:
            raise Refused(f"unknown question engine '{q}'")
    cases, everything, split = select_cases(opts)
    if not cases:
        raise Refused("no cases to evaluate (run `npm run bench:convert`, or add --fixtures)")
    provider = deps.provider
    if provider is None:
        env = {**os.environ}
        if env.get("LLM_PROVIDER", "mock") != "mock":
            env["LLM_ALLOW_REAL_DATA"] = (
                "true"  # replaced by the simulated-text rule in check_hosted_model
            )
        try:
            provider = build_provider(env, deps.settings.llm_cache_dir)
        except ProviderError as exc:
            raise Refused(f"language model not available: {exc}") from exc
    rules = deps.rules or run_rules_script
    probe = rules([], opts.pathway_dir)
    state = tuning_state(models_in_use(opts, provider), {"question_engine": probe["config"]})

    includes_test = split is not None and (
        opts.split in ("test", "all") and any(c["id"] in split["test"] for c in cases)
    )
    if includes_test and split is not None:
        reasons = check_frozen(split, everything, state)
        if reasons:
            raise Refused(
                "TUNING DETECTED, the test set is not evaluated:\n  " + "\n  ".join(reasons), 3
            )

    cache = Cache(opts.cache_dir)
    planned_asr: list = []
    planned_llm: list = []
    real_cases = [c for c in cases if not c.get("synthetic")]
    spend = SpendGuard(
        UsageLog(deps.settings.usage_log_path),
        deps.settings.monthly_cap_minutes,
        deps.settings.smoke_max_seconds,
    )

    # plan first: count what is not cached and refuse hosted text that is not declared simulated
    check_hosted_model(real_cases, provider, opts, deps, 0)

    cells: list[dict] = []
    case_rows: list[dict] = []
    skipped_no_audio = 0
    for asr in opts.asr:
        texts: dict[str, list[str]] = {}
        wer_rows: dict[str, metrics.ErrorCount] = {}
        cer_rows: dict[str, metrics.ErrorCount] = {}
        asr_version = "gold-transcript"
        for case in cases:
            if asr == "gold":
                texts[case["id"]] = gold_lines(case)
                continue
            hyp = transcribe(case, asr, opts, deps, cache, spend, planned_asr)
            if hyp is None:
                skipped_no_audio += 1
                continue
            if hyp.get("pending"):
                continue
            asr_version = hyp["version"]
            texts[case["id"]] = hyp["lines"]
            ref, hypo = " ".join(gold_lines(case)), " ".join(hyp["lines"])
            wer_rows[case["id"]] = metrics.wer_count(ref, hypo)
            cer_rows[case["id"]] = metrics.cer_count(ref, hypo)
        used = [c for c in cases if c["id"] in texts]
        for variant in opts.variants:
            packed = []
            medicine_gold: list[str] = []
            medicine_pred: list[str] = []
            sources = [(c, texts[c["id"]]) for c in used]
            to_send = sum(
                1
                for c, lines in sources
                if provider.name != "mock"
                and not cache.has(_extract_key(c, lines, variant, provider, cache))
            )
            if to_send:
                check_hosted_model(real_cases, provider, opts, deps, to_send)
            for case, lines in sources:
                record = extract(case, lines, variant, provider, cache, opts, deps, planned_llm)
                if record is None:
                    continue
                predicted = []
                for p in record["predicted"]:
                    fact = metrics.PredictedFact(**p)
                    predicted.append(
                        fact if asr == "gold" else fact.model_copy(update={"segment_label": None})
                    )
                packed.append((gold_facts(case), lines, predicted))
                medicine_gold += [m["generic"] for m in case.get("medicine_mentions", [])]
                medicine_pred += [p.value for p in predicted if p.type == "current_medicine"]
                one = metrics.fact_scores([packed[-1]])
                case_rows.append(
                    {
                        "case": case["id"],
                        "synthetic": bool(case.get("synthetic")),
                        "asr": asr,
                        "variant": variant,
                        "tp": one["overall"]["tp"],
                        "fp": one["overall"]["fp"],
                        "fn": one["overall"]["fn"],
                        "f1": round(one["overall"]["f1"], 4),
                        "ungrounded": one["hallucination"]["ungrounded"],
                        "proposed": one["hallucination"]["proposed"],
                        "wer": round(wer_rows[case["id"]].rate, 4)
                        if case["id"] in wer_rows
                        else None,
                    }
                )
            facts = metrics.fact_scores(packed) if packed else None
            wer = metrics.micro(wer_rows.values()) if wer_rows else None
            cer = metrics.micro(cer_rows.values()) if cer_rows else None
            cells.append(
                {
                    "asr": asr,
                    "asr_version": asr_version,
                    "variant": variant,
                    "cases": len(packed),
                    "facts": facts,
                    "wer": None
                    if wer is None
                    else {"rate": wer.rate, "errors": wer.errors, "ref_words": wer.reference_units},
                    "cer": None
                    if cer is None
                    else {"rate": cer.rate, "errors": cer.errors, "ref_chars": cer.reference_units},
                    "medicine": metrics.medicine_accuracy(medicine_gold, medicine_pred)
                    if medicine_gold
                    else None,
                }
            )

    questions = _question_stage(cases, opts, rules, cache, probe)
    extras: dict[str, object] = {}
    if opts.fhir_csv:
        extras["fhir_validity"] = metrics.fhir_validity(metrics.read_fhir_csv(opts.fhir_csv))
    if opts.time_csv:
        extras["time_to_sign"] = metrics.time_to_sign(opts.time_csv)
    if opts.questionnaire_csv:
        extras["questionnaire"] = metrics.questionnaire_scores(opts.questionnaire_csv)

    with_audio = sum(1 for c in cases if c["audio"].get("file"))
    scripts = {"gujarati": 0.0, "devanagari": 0.0, "latin": 0.0}
    for c in cases:
        share = script_share(" ".join(gold_lines(c)))
        for k in scripts:
            scripts[k] += share[k]
    manifest = {
        "run_at": deps.now().isoformat(timespec="seconds"),
        "code_commit": _git_commit(),
        "split": opts.split,
        "split_hash": split_hash(split) if split else None,
        "test_cases_evaluated": includes_test,
        "dataset_hash": dataset_hash(cases),
        "cases": [c["id"] for c in cases],
        "synthetic_fixtures_included": any(c.get("synthetic") for c in cases),
        "asr_engines": {
            a: next((x["asr_version"] for x in cells if x["asr"] == a), None) for a in opts.asr
        },
        "llm": {"provider": provider.name, "model": provider.model},
        "prompt_hashes": {v: prompt_hash_of(v) for v in opts.variants},
        "pathways": {
            "set": "toy",
            "versions": probe.get("pathway_versions"),
            "question_engine_config": probe["config"],
        },
        "question_engines": opts.questions,
        "cache": {"hits": cache.hits, "misses": cache.misses},
        "not_cached_and_not_run": {"asr": len(planned_asr), "extraction": len(planned_llm)},
        "skipped_no_audio": skipped_no_audio,
        "tuning_state": state,
    }
    return {
        "manifest": manifest,
        "note": export.confidence_note(
            len(cases), with_audio, manifest["synthetic_fixtures_included"]
        ),
        "cells": cells,
        "case_rows": case_rows,
        "questions": questions,
        "extras": extras,
    }


def _extract_key(
    case: dict, lines: list[str], variant: str, provider: LlmProvider, cache: Cache
) -> str:
    return cache.key(
        "extract",
        provider=provider.name,
        model=provider.model,
        variant=variant,
        prompt=prompt_hash_of(variant),
        text=digest(lines),
        canned=None,
    )


def _question_stage(
    cases: list[dict], opts: Options, rules: RulesRunner, cache: Cache, probe: dict
) -> list[dict]:
    toy = [c for c in cases if c.get("pathway_set") == "toy"]
    rows: list[dict] = []
    for engine in opts.questions:
        if engine in NOT_BUILT:
            rows.append({"engine": engine, "status": NOT_BUILT[engine], "pathways": "toy"})
            continue
        if not toy:
            rows.append({"engine": engine, "status": "no toy cases", "pathways": "toy"})
            continue
        payload = [
            {
                "id": c["id"],
                "condition_label": c.get("condition_label"),
                "oracle_slots": c.get("oracle_slots", {}),
            }
            for c in toy
        ]
        key = cache.key(
            "rules",
            script=digest(RULES_SCRIPT.read_text(encoding="utf-8"))
            if RULES_SCRIPT.exists()
            else None,
            pathways=probe.get("pathway_versions"),
            config=probe["config"],
            cases=payload,
        )
        out = cache.get(key)
        if out is None:
            out = rules(toy, opts.pathway_dir)
            cache.put(key, out)
        by_id = {c["id"]: c for c in toy}
        results = [
            {
                "label": by_id[r["id"]].get("condition_label"),
                "top1": r["top1"],
                "top3": r["top3"],
                "questions_to_top3": r["questions_to_top3"],
                "red_flag": bool(by_id[r["id"]].get("red_flag")),
                "stopped": r["red_flag_stopped"],
            }
            for r in out["results"]
        ]
        rows.append(
            {
                "engine": engine,
                "status": "toy pathways only",
                "pathways": "toy",
                "pathway": metrics.pathway_scores(results),
                "red_flag": metrics.red_flag_recall(results),
            }
        )
    return rows


# ------------------------------------------------------------------ command line
def parse(argv: list[str]) -> Options:
    ap = argparse.ArgumentParser(prog="bench:run", description="VaaniBench-Gu batch runner")
    ap.add_argument("--split", choices=["dev", "test", "all"], default="dev")
    ap.add_argument(
        "--asr",
        default="gold",
        help="comma list: gold (the gold transcript), mock, sarvam, indicconformer, faster-whisper",
    )
    ap.add_argument("--variants", default=",".join(VARIANTS))
    ap.add_argument("--questions", default=",".join(QUESTION_ENGINES))
    ap.add_argument(
        "--fixtures",
        action="store_true",
        help="also run the tracked synthetic fixtures (labelled as such)",
    )
    ap.add_argument("--cases", type=Path, default=DATA_ROOT / "cases")
    ap.add_argument("--split-file", type=Path, default=DATA_ROOT / "split.json")
    ap.add_argument("--cache-dir", type=Path, default=DATA_ROOT / "cache")
    ap.add_argument("--out-dir", type=Path)
    ap.add_argument("--fhir-csv", type=Path)
    ap.add_argument("--time-csv", type=Path)
    ap.add_argument("--questionnaire-csv", type=Path)
    ap.add_argument(
        "--yes-run",
        action="store_true",
        help="allow uncached paid or hosted calls (existing caps still apply)",
    )
    a = ap.parse_args(argv)
    split = [x for x in a.asr.split(",") if x]
    return Options(
        cases_dir=a.cases,
        fixtures=a.fixtures,
        split=a.split,
        split_file=a.split_file,
        asr=split,
        variants=[x for x in a.variants.split(",") if x],
        questions=[x for x in a.questions.split(",") if x],
        yes_run=a.yes_run,
        out_dir=a.out_dir,
        cache_dir=a.cache_dir,
        fhir_csv=a.fhir_csv,
        time_csv=a.time_csv,
        questionnaire_csv=a.questionnaire_csv,
    )


def main(argv: list[str], out: Callable[[str], None] = print, deps: Deps | None = None) -> int:
    opts = parse(argv)
    deps = deps or Deps(load_settings(), out=out)
    try:
        run = execute(opts, deps)
    except Refused as exc:
        out(str(exc))
        return exc.code
    folder = opts.out_dir or (REPO_ROOT / "results" / deps.now().strftime("%Y%m%dT%H%M%S"))
    export.write_outputs(folder, run)
    m = run["manifest"]
    out(
        f"{len(m['cases'])} case(s), cache {m['cache']['hits']} hit(s) / {m['cache']['misses']} miss(es)"
    )
    pending = m["not_cached_and_not_run"]
    if pending["asr"] or pending["extraction"]:
        out(
            f"not run (add --yes-run): {pending['asr']} ASR clip(s), {pending['extraction']} extraction request(s)"
        )
    out(run["note"])
    out(f"results: {folder}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
