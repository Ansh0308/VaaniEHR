"""Batch runner, cache, split refusals and result files (Phase 11A, ADR-D43). Fake data, fake engines, fake providers only."""

from __future__ import annotations

import copy
import json
import wave
from pathlib import Path

import pytest

from app.asr.mock import DEMO_SCRIPT, MockEngine
from app.bench import export, runner
from app.bench import split as sp
from app.bench.cache import Cache, digest
from app.bench.dataset import BENCH_ROOT, load_cases
from app.config import load_settings
from app.extraction.provider import LlmResponse

FIXTURES = BENCH_ROOT / "fixtures"
TOY_CONFIG = {"question_cap": 8, "abstain_threshold": 0.5}


def fake_rules(cases: list[dict], _dir: Path) -> dict:
    return {
        "engine": "rules-only",
        "pathways": "toy",
        "pathway_versions": [{"id": "toy_condition_a", "version": 1}],
        "config": TOY_CONFIG,
        "results": [
            {
                "id": c["id"],
                "top1": c.get("condition_label"),
                "top3": [c.get("condition_label")],
                "questions": 2,
                "questions_to_top3": 1,
                "red_flag_stopped": bool(c.get("red_flag")),
                "outcome": "COMPLETE",
            }
            for c in cases
        ],
    }


class HostedFake:
    """A paid, hosted-looking provider that counts requests."""

    name = "fake-hosted"
    model = "fake-1"
    paid = True

    def __init__(self) -> None:
        self.requests_made = 0

    async def complete(self, system: str, user: str, *, structured: bool = True) -> LlmResponse:
        self.requests_made += 1
        text = json.dumps({"facts": []})
        return LlmResponse(text, self.model, 10, 5)


@pytest.fixture
def opts(tmp_path: Path) -> runner.Options:
    return runner.Options(
        cases_dir=tmp_path / "cases",
        audio_root=tmp_path,
        fixtures=True,
        split="all",
        split_file=tmp_path / "split.json",
        cache_dir=tmp_path / "cache",
        own_dir=tmp_path / "own",
    )


def deps(**kw) -> runner.Deps:  # noqa: ANN003
    return runner.Deps(load_settings(), rules=fake_rules, out=lambda _l: None, **kw)


def real_cases(folder: Path, n: int = 6) -> list[dict]:
    folder.mkdir(parents=True, exist_ok=True)
    base = load_cases(FIXTURES)[0]
    out = []
    for i in range(n):
        c = copy.deepcopy(base)
        c.update(id=f"real{i:02d}", synthetic=False)
        c.pop("mock_output", None)
        (folder / f"{c['id']}.json").write_text(json.dumps(c), encoding="utf-8")
        out.append(c)
    return out


def test_the_grid_runs_and_marks_what_is_not_built(opts: runner.Options):
    run = runner.execute(opts, deps())
    assert {(c["asr"], c["variant"]) for c in run["cells"]} == {
        ("gold", "plain"),
        ("gold", "constrained"),
        ("gold", "grounded"),
    }
    by = {q["engine"]: q for q in run["questions"]}
    assert by["llm-only"]["status"] == "not built" and by["hybrid"]["status"] == "not built"
    assert (
        by["rules-only"]["status"] == "toy pathways only" and by["rules-only"]["pathways"] == "toy"
    )
    # the grounded variant drops the invented fact; plain keeps it and the rate shows it
    rates = {c["variant"]: c["facts"]["hallucination"]["rate"] for c in run["cells"]}
    assert rates["grounded"] == 0.0 and rates["plain"] > 0.0


def test_a_rerun_is_free_and_identical(opts: runner.Options, tmp_path: Path):
    first = runner.execute(opts, deps())
    second = runner.execute(opts, deps())
    assert first["manifest"]["cache"]["misses"] > 0
    assert second["manifest"]["cache"]["misses"] == 0
    assert second["manifest"]["cache"]["hits"] >= first["manifest"]["cache"]["misses"]
    assert first["cells"] == second["cells"] and first["questions"] == second["questions"]


def test_the_cache_key_changes_with_a_prompt_hash(
    opts: runner.Options, monkeypatch: pytest.MonkeyPatch
):
    runner.execute(opts, deps())
    monkeypatch.setattr(runner, "prompt_hash_of", lambda v: "f" * 64)
    again = runner.execute(opts, deps())
    assert again["manifest"]["cache"]["misses"] > 0


def test_cache_primitives(tmp_path: Path):
    c = Cache(tmp_path)
    k = c.key("s", a=1, b="x")
    assert c.get(k) is None and c.misses == 1
    c.put(k, {"v": 1})
    assert c.get(k) == {"v": 1} and c.hits == 1 and c.has(k)
    assert c.key("s", a=1, b="y") != k and digest({"a": 1}) == digest({"a": 1})


def test_a_hosted_model_needs_yes_run_and_declared_simulated_text(opts: runner.Options):
    opts.fixtures = True
    run = runner.execute(
        opts, deps(provider=HostedFake())
    )  # synthetic fixtures need no declaration
    # no --yes-run: nothing was sent
    assert run["manifest"]["not_cached_and_not_run"]["extraction"] > 0
    assert all(c["cases"] == 0 for c in run["cells"])
    # a real (non-synthetic) case that is not declared simulated is refused
    real_cases(opts.cases_dir)
    with pytest.raises(runner.Refused, match="is missing: list real00.txt"):
        runner.execute(opts, deps(provider=HostedFake()))


def test_yes_run_sends_each_request_once_and_caches_it(opts: runner.Options):
    opts.yes_run = True
    provider = HostedFake()
    runner.execute(opts, deps(provider=provider))
    sent = provider.requests_made
    assert sent == 9  # 3 fixtures x 3 variants
    runner.execute(opts, deps(provider=provider))
    assert provider.requests_made == sent


def test_the_per_run_request_cap_refuses(opts: runner.Options):
    opts.yes_run = True
    settings = load_settings().model_copy(update={"llm_request_cap": 2})
    with pytest.raises(runner.Refused, match="request cap"):
        runner.execute(
            opts,
            runner.Deps(settings, rules=fake_rules, provider=HostedFake(), out=lambda _l: None),
        )


def test_dev_and_test_need_a_frozen_split(opts: runner.Options):
    opts.split = "dev"
    real_cases(opts.cases_dir)
    with pytest.raises(runner.Refused, match="no frozen split"):
        runner.execute(opts, deps())


def freeze_for(opts: runner.Options, models: list[str] | None = None) -> dict:
    cases = load_cases(opts.cases_dir)
    state = sp.tuning_state(models or ["gold", "mock-model"], {"question_engine": TOY_CONFIG})
    split = sp.freeze(cases, state)
    opts.split_file.write_text(json.dumps(split), encoding="utf-8")
    return split


def test_the_test_split_runs_when_clean_and_refuses_on_any_tuning(
    opts: runner.Options, monkeypatch: pytest.MonkeyPatch
):
    real_cases(opts.cases_dir, 8)
    split = freeze_for(opts)
    opts.fixtures = False
    opts.split = "test"
    run = runner.execute(opts, deps())
    assert (
        set(run["manifest"]["cases"]) == set(split["test"])
        and run["manifest"]["test_cases_evaluated"]
    )

    # 1. a prompt is edited
    monkeypatch.setattr(sp, "prompt_hash_of", lambda v: "0" * 64)
    with pytest.raises(runner.Refused, match="(?s)TUNING DETECTED.*prompt was edited") as exc:
        runner.execute(opts, deps())
    assert exc.value.code == 3
    monkeypatch.undo()

    # 2. a new model or engine
    opts.asr = ["gold", "indicconformer"]
    with pytest.raises(runner.Refused, match="not in the frozen list"):
        runner.execute(opts, deps())
    opts.asr = ["gold"]

    # 3. a changed threshold
    def changed(cases: list[dict], d: Path) -> dict:
        out = fake_rules(cases, d)
        out["config"] = {**TOY_CONFIG, "question_cap": 6}
        return out

    with pytest.raises(runner.Refused, match="threshold"):
        runner.execute(opts, runner.Deps(load_settings(), rules=changed, out=lambda _l: None))

    # 4. an edited test case
    target = split["test"][0]
    path = opts.cases_dir / f"{target}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["gold_facts"][0]["value"] = "edited after the freeze"
    path.write_text(json.dumps(data), encoding="utf-8")
    with pytest.raises(runner.Refused, match="edited since the freeze"):
        runner.execute(opts, deps())


def test_dev_runs_are_not_blocked_by_tuning(opts: runner.Options, monkeypatch: pytest.MonkeyPatch):
    real_cases(opts.cases_dir, 8)
    split = freeze_for(opts)
    opts.fixtures = False
    opts.split = "dev"
    monkeypatch.setattr(sp, "prompt_hash_of", lambda v: "0" * 64)
    run = runner.execute(opts, deps())
    assert (
        set(run["manifest"]["cases"]) == set(split["dev"])
        and not run["manifest"]["test_cases_evaluated"]
    )


def wav(path: Path, seconds: float = 0.5) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * int(16000 * seconds))


def test_the_asr_stage_scores_wer_and_caches(opts: runner.Options):
    cases = real_cases(opts.cases_dir, 2)
    for c in cases:
        wav(opts.audio_root / "audio" / f"{c['id']}.wav")
        c["audio"] = {
            "file": f"audio/{c['id']}.wav",
            "sha256": "a" * 64,
            "duration_s": 0.5,
            "noise_level": "clean",
        }
        (opts.cases_dir / f"{c['id']}.json").write_text(json.dumps(c), encoding="utf-8")
    opts.fixtures = False
    opts.asr = ["mock"]
    calls = []

    def factory(name, settings, spend, verified, terms, mode="codemix"):  # noqa: ANN001, ANN202
        calls.append(name)
        return MockEngine(DEMO_SCRIPT)

    first = runner.execute(
        opts, runner.Deps(load_settings(), factory=factory, rules=fake_rules, out=lambda _l: None)
    )
    cell = next(c for c in first["cells"] if c["variant"] == "grounded")
    assert cell["wer"] is not None and cell["wer"]["ref_words"] > 0 and cell["cer"] is not None
    assert first["manifest"]["asr_engines"]["mock"]
    second = runner.execute(
        opts, runner.Deps(load_settings(), factory=factory, rules=fake_rules, out=lambda _l: None)
    )
    assert second["manifest"]["cache"]["misses"] == 0


def test_a_paid_asr_engine_does_not_start_without_yes_run(opts: runner.Options):
    cases = real_cases(opts.cases_dir, 1)
    c = cases[0]
    wav(opts.audio_root / "audio" / "a.wav")
    c["audio"] = {
        "file": "audio/a.wav",
        "sha256": "b" * 64,
        "duration_s": 0.5,
        "noise_level": "clean",
    }
    (opts.cases_dir / f"{c['id']}.json").write_text(json.dumps(c), encoding="utf-8")
    opts.fixtures = False
    opts.asr = ["sarvam"]
    started = []

    def factory(name, *a, **k):  # noqa: ANN002, ANN003, ANN202
        started.append(name)
        return MockEngine(DEMO_SCRIPT)

    run = runner.execute(
        opts, runner.Deps(load_settings(), factory=factory, rules=fake_rules, out=lambda _l: None)
    )
    assert run["manifest"]["not_cached_and_not_run"]["asr"] == 1
    assert run["cells"][0]["wer"] is None
    # with --yes-run a paid engine still needs the owner's own voice
    opts.yes_run = True
    with pytest.raises(runner.Refused, match="own voice"):
        runner.execute(
            opts,
            runner.Deps(load_settings(), factory=factory, rules=fake_rules, out=lambda _l: None),
        )


def test_result_files_carry_the_manifest_and_the_confidence_note(
    opts: runner.Options, tmp_path: Path
):
    run = runner.execute(opts, deps())
    out = tmp_path / "out"
    export.write_outputs(out, run)
    names = {p.name for p in out.iterdir()}
    assert {
        "manifest.json",
        "cells.csv",
        "cases.csv",
        "questions.csv",
        "summary.md",
        "table.tex",
    } <= names
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    for key in (
        "dataset_hash",
        "prompt_hashes",
        "pathways",
        "asr_engines",
        "llm",
        "code_commit",
        "tuning_state",
    ):
        assert key in manifest
    assert manifest["pathways"]["set"] == "toy"
    md = (out / "summary.md").read_text(encoding="utf-8")
    assert (
        md.count("one speaker / acted data") >= 2
        and "TOY pathways only" in md
        and "not built" in md
    )
    tex = (out / "table.tex").read_text(encoding="utf-8")
    assert "one speaker / acted data" in tex and "\\begin{tabular}" in tex and "\\%" in tex
    assert "gold" in (out / "cells.csv").read_text(encoding="utf-8")
    # no gold text or transcript leaks into the result files
    secret = load_cases(FIXTURES)[0]["transcript"]["segments"][1]["text"]
    assert all(secret not in p.read_text(encoding="utf-8") for p in out.iterdir())


def test_latex_escaping():
    assert export.tex_escape("a_b & 50%") == "a\\_b \\& 50\\%"


def test_confidence_note_wording():
    note = export.confidence_note(11, 1, False)
    assert "N = 11" in note and "one speaker / acted data" in note and "not a result" in note
    assert "Synthetic" in export.confidence_note(3, 0, True)


def test_the_real_rules_engine_on_the_toy_pathways():
    cases = load_cases(FIXTURES)
    out = runner.run_rules_script(cases, runner.TOY_PATHWAYS)
    by = {r["id"]: r for r in out["results"]}
    assert by["synthetic01"]["top1"] == "toy_condition_a"
    assert by["synthetic02"]["red_flag_stopped"] is True
    assert out["pathways"] == "toy" and out["config"]["question_cap"] == 8
