"""The evaluation command: dry run, own-voice rule, aggregate maths, output files. Fake engine; nothing is sent."""

import argparse
import json
import wave

import numpy as np
import pytest

from app.asr.mock import MockEngine
from app.config import Settings
from app.eval import find_clips, run
from app.own_voice import sha256_of


def wav(path, seconds=2.0):
    n = int(16000 * seconds)
    tone = (0.3 * np.sin(2 * np.pi * 440 * np.arange(n) / 16000) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(tone.tobytes())


@pytest.fixture
def env(tmp_path):
    own = tmp_path / "own"
    own.mkdir()
    for name, ref, _hyp in (
        ("a", "namaste doctor tav che", "namaste doctor tav che"),
        ("b", "one two three four", "one 2 three"),
    ):
        wav(own / f"{name}.wav")
        (own / f"{name}.txt").write_text(ref, encoding="utf-8")
    wav(own / "c.wav")  # no reference: skipped
    (own / "a.lang").write_text("hi-IN", encoding="utf-8")
    scripts = {"a": "namaste doctor tav che", "b": "one 2 three"}
    calls = []

    def factory(name, _settings, _spend, _verified, _terms, mode="codemix"):
        calls.append(name)
        text = scripts["a" if len(calls) == 1 else "b"]
        return type("PaidMock", (MockEngine,), {"name": name})(
            [{"start_ms": 0, "end_ms": 1000, "text": text}]
        )

    def go(*, yes=False, engine="sarvam", listed=True):
        if listed:
            files = {
                f"{n}.wav": {"voice": "owner", "sha256": sha256_of(own / f"{n}.wav")}
                for n in ("a", "b")
            }
            (own / "manifest.json").write_text(json.dumps({"files": files}))
        args = argparse.Namespace(engine=engine, dir=str(own), mode="codemix", yes_spend=yes)
        lines: list[str] = []
        code = run(args, Settings(data_dir=tmp_path / "data"), factory, lines.append, own_dir=own)
        return code, "\n".join(lines)

    return type("E", (), {"go": staticmethod(go), "calls": calls, "own": own, "tmp": tmp_path})


def test_clips_need_a_reference_and_may_have_a_language_tag(env):
    clips, missing = find_clips(env.own)
    assert [c.name for c in clips] == ["a", "b"] and missing == ["c.wav"]
    assert [c.language for c in clips] == ["hi-IN", "gu-IN"]


def test_the_default_is_a_dry_run_with_count_seconds_cost_and_the_own_voice_verdict(env):
    code, text = env.go()
    assert code == 0 and env.calls == [] and "DRY RUN" in text
    assert "2 clips" in text and "4.0 s" in text and "estimated cost INR 0.03" in text
    assert "own-voice rule: 2 pass, 0 refused" in text
    assert not (env.tmp / "data" / "eval").exists()


def test_clips_not_listed_as_own_voice_stop_the_whole_run_before_anything_is_sent(env):
    code, text = env.go(yes=True, listed=False)
    assert code == 3 and "not listed as the owner's own voice" in text and env.calls == []


def test_a_real_run_gives_per_clip_and_aggregate_numbers_and_writes_private_files(env):
    code, text = env.go(yes=True)
    assert code == 0 and env.calls == ["sarvam", "sarvam"]
    # clip a: 0 errors / 4 words; clip b: 1 substituted + 1 missing / 4 words -> aggregate 2 errors / 8 words
    assert "a: strict 0.0%" in text and "b: strict 50.0%" in text
    assert "| sarvam | codemix | 2 | 8 | 25.0% |" in text
    folder = next((env.tmp / "data" / "eval").iterdir())
    rows = (folder / "results.csv").read_text(encoding="utf-8").splitlines()
    assert rows[0].startswith("clip,language,reference_words,strict_wer_pct") and len(rows) == 3
    assert "namaste" not in (folder / "results.md").read_text(
        encoding="utf-8"
    )  # aggregate file: numbers only
    assert (folder / "hyp" / "a.txt").exists()
    usage = (env.tmp / "data" / "usage.jsonl").read_text(encoding="utf-8").splitlines()
    assert len(usage) == 2 and all('"text"' not in line and "namaste" not in line for line in usage)


def test_a_folder_without_clips_is_explained(tmp_path):
    (tmp_path / "x").mkdir()
    args = argparse.Namespace(
        engine="sarvam", dir=str(tmp_path / "x"), mode="codemix", yes_spend=False
    )
    lines: list[str] = []
    assert run(args, Settings(data_dir=tmp_path / "d"), out=lines.append) == 2
    assert "no clips" in lines[0]
