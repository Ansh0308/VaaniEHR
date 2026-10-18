"""The manual smoke script: dry run by default, own-voice rule, caps, WER. Uses a fake engine; nothing is sent anywhere."""

import json
import wave

import numpy as np
import pytest

from app import smoke
from app.asr.mock import MockEngine
from app.config import Settings
from app.own_voice import sha256_of
from app.wer import wer


def make_wav(path, seconds=2.0, rate=48000, channels=2):
    n = int(seconds * rate)
    tone = (0.3 * np.sin(2 * np.pi * 440 * np.arange(n) / rate) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(np.repeat(tone[:, None], channels, axis=1).tobytes())


@pytest.fixture
def env(tmp_path, monkeypatch):
    own = tmp_path / "audio" / "own"
    own.mkdir(parents=True)
    monkeypatch.setattr("app.smoke.OWN_DIR", own)
    monkeypatch.setattr("app.own_voice.OWN_DIR", own)
    clip = own / "clip01.wav"
    make_wav(clip)
    (own / "clip01.txt").write_text("namaste doctor tav che", encoding="utf-8")
    settings = Settings(data_dir=tmp_path / "data")
    built = []

    def factory(name, _settings, _spend, verified, terms):
        built.append((name, verified, list(terms)))
        return type("PaidMock", (MockEngine,), {"name": name})(
            [{"start_ms": 0, "end_ms": 1000, "text": "namaste doctor tav che", "language": "gu-IN"}]
        )

    def go(*extra, settings=settings):
        args = smoke.argparse.Namespace(
            engine="sarvam", file=str(clip), reference=str(own / "clip01.txt"),
            keyterms=str(tmp_path / "k.txt"), language="gu-IN", seconds=None, both=False,
            no_keyterms=False, yes_spend=False,
        )  # fmt: skip
        for key in extra:
            name, _, value = key.partition("=")
            setattr(
                args,
                name,
                {"True": True, "False": False}.get(
                    value, float(value) if value.isdigit() else value
                ),
            )
        lines: list[str] = []
        code = smoke.run_command(args, settings, factory, lines.append)
        return code, "\n".join(lines)

    (tmp_path / "k.txt").write_text("# status: unreviewed\nDrug-A\nDrug-B\n", encoding="utf-8")
    return type("E", (), {"go": staticmethod(go), "built": built, "own": own, "clip": clip, "tmp": tmp_path,
                          "settings": settings})  # fmt: skip


def list_own(env):
    (env.own / "manifest.json").write_text(
        json.dumps({"files": {"clip01.wav": {"voice": "owner", "sha256": sha256_of(env.clip)}}})
    )


def test_the_default_is_a_dry_run_that_sends_nothing_and_prints_the_estimate(env):
    list_own(env)
    code, text = env.go()
    assert code == 0 and "DRY RUN" in text and env.built == []
    assert "2.0 s long" in text and "estimated cost INR 0.02" in text  # 2 s * 30 / 3600
    assert "passes" in text and not (env.tmp / "data" / "usage.jsonl").exists()


def test_a_file_that_is_not_listed_as_own_voice_is_refused_for_sarvam_even_with_yes(env):
    code, text = env.go("yes_spend=True")
    assert code == 3 and "REFUSED" in text and env.built == []


def test_a_listed_file_runs_logs_usage_and_reports_wer(env):
    list_own(env)
    code, text = env.go("yes_spend=True")
    assert code == 0 and env.built == [("sarvam", True, ["Drug-A", "Drug-B"])]
    assert "WER 0.0%" in text and "0 substituted + 0 missing + 0 extra) / 4 reference words" in text
    line = json.loads((env.tmp / "data" / "usage.jsonl").read_text().splitlines()[0])
    assert (line["purpose"], line["engine"]) == ("smoke", "sarvam") and "text" not in line


def test_both_runs_with_and_without_keyterms_and_doubles_the_estimate(env):
    list_own(env)
    _, plan = env.go("both=True")
    assert "estimated cost INR 0.03" in plan  # 4 s
    code, _ = env.go("both=True", "yes_spend=True")
    assert code == 0 and [b[2] for b in env.built] == [["Drug-A", "Drug-B"], []]


def test_more_than_300_seconds_or_an_exhausted_month_is_refused(env):
    list_own(env)
    code, text = env.go("seconds=301")
    assert code == 2 and "300 s per-run cap" in text
    from app.usage import UsageLog

    UsageLog(env.tmp / "data" / "usage.jsonl").add(
        request_id="r",
        purpose="stream",
        engine="sarvam",
        engine_version="v",
        audio_seconds=300 * 60,
    )
    code, text = env.go("yes_spend=True")
    assert code == 3 and "monthly" in text and env.built == []


def test_listing_a_file_as_own_voice_needs_the_owners_statement(env):
    assert (
        smoke.own_list(env.clip, False, env.own) == 2 and not (env.own / "manifest.json").exists()
    )
    assert smoke.own_list(env.clip, True, env.own) == 0
    assert (
        json.loads((env.own / "manifest.json").read_text())["files"]["clip01.wav"]["voice"]
        == "owner"
    )


def test_wav_loading_downmixes_and_resamples(env):
    pcm, duration = smoke.load_wav_16k_mono(env.clip, 1.0)
    assert duration == pytest.approx(2.0) and len(pcm) == 32000  # 1 s of 16 kHz mono 16-bit


def test_wer_counts_are_exact():
    r = wer("one two three four", "one 2 three four five")
    assert (r.substitutions, r.deletions, r.insertions, r.reference_words) == (1, 0, 1, 4)
    assert wer("ક્યારથી છે", "ક્યારથી છે").wer == 0 and wer("a b", "").deletions == 2
