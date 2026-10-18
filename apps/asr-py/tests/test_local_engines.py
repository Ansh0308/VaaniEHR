"""Local engines with fake models (no torch, no transformers, no download), the VAD gate and the download command."""

import re
import sys
import types

import numpy as np
import pytest

from app.asr.fasterwhisper import FasterWhisperEngine
from app.asr.indicconformer import IndicConformerEngine
from app.asr.local import UtteranceEngine
from app.asr.models import ALL_PINNED, NotInContainer, require_container
from app.asr.types import SAMPLE_RATE, Capabilities
from app.models_cli import main as models_main
from app.vad import EnergyBackend, VadGate

pytestmark = pytest.mark.anyio


def pcm(*parts: tuple[str, int]) -> bytes:
    out = []
    for kind, ms in parts:
        n = SAMPLE_RATE * ms // 1000
        wave = (
            np.zeros(n)
            if kind == "q"
            else 0.3 * np.sin(2 * np.pi * 440 * np.arange(n) / SAMPLE_RATE)
        )
        out.append((wave * 32767).astype("<i2").tobytes())
    return b"".join(out)


async def feed(audio: bytes, step: int = 8000):
    for i in range(0, len(audio), step):
        yield audio[i : i + step]


SPEECH = pcm(("q", 800), ("s", 1000), ("q", 1200), ("s", 700), ("q", 900))


# ------------------------------------------------------------------ VadGate
def test_the_gate_drops_silence_and_maps_times_back():
    gate = VadGate(EnergyBackend())
    sent = gate.push(SPEECH)
    total_ms, kept_ms = len(SPEECH) // 32, len(sent) // 32
    assert 0 < kept_ms < total_ms * 0.8  # a good part of the silence is gone
    assert (
        600 <= gate.to_original_ms(0) <= 800
    )  # the first kept audio starts just before the first speech
    second_block = gate._blocks[1]  # noqa: SLF001
    assert gate.to_original_ms(second_block[0]) == second_block[1]
    assert gate.to_original_ms(gate.sent_ms, end=True) >= gate.to_original_ms(gate.sent_ms - 32)


def test_chunk_size_does_not_change_what_the_gate_keeps():
    whole = VadGate(EnergyBackend()).push(SPEECH)
    for step in (1, 777, 4096):
        gate = VadGate(EnergyBackend())
        assert (
            b"".join(gate.push(SPEECH[i : i + step]) for i in range(0, len(SPEECH), step)) == whole
        )


# ------------------------------------------------------------------ utterance engines
class Echo(UtteranceEngine):
    name, version = "echo", "0"
    capabilities = Capabilities(False, False, False, False, False, False)

    def _decode(self, samples, language):
        return f"utterance {len(samples) // 1600} lang={language}", None


async def test_one_final_per_utterance_with_real_times_and_keyterms_reported_as_ignored():
    engine = Echo()
    got = [s async for s in engine.transcribe_stream(feed(SPEECH), "gu-IN", ["Drug-A"])]
    assert len(got) == 2 and all(s.kind == "final" for s in got)
    assert got[0].start_ms >= 600 and got[0].end_ms < got[1].start_ms
    assert got[0].text.endswith("lang=gu") and got[0].confidence is None
    assert engine.report.keyterms_applied == 0 and "ignored" in engine.report.notes[0]
    assert engine.report.audio_seconds == pytest.approx(len(SPEECH) / 32000)


# ------------------------------------------------------------------ IndicConformer
def test_indicconformer_refuses_to_run_outside_the_container(monkeypatch, tmp_path):
    monkeypatch.delenv("ASR_IN_CONTAINER", raising=False)
    monkeypatch.setattr("app.asr.models.Path", lambda *_: tmp_path / "no-dockerenv")
    with pytest.raises(NotInContainer):
        require_container()
    monkeypatch.setenv("ASR_IN_CONTAINER", "1")
    require_container()


def test_the_pinned_revisions_are_exact_commit_hashes():
    for pin in ALL_PINNED.values():
        assert re.fullmatch(r"[0-9a-f]{40}", pin.revision), pin.repo


def test_indicconformer_loads_the_pinned_revision_only_and_calls_gu_ctc(monkeypatch):
    monkeypatch.setenv("ASR_IN_CONTAINER", "1")
    monkeypatch.setenv("HF_TOKEN", "fake-token")
    seen = {}

    class FakeModel:
        def __call__(self, wav, lang, mode):
            seen["call"] = (tuple(wav.shape), lang, mode)
            return "namaste"

    class FakeAutoModel:
        @staticmethod
        def from_pretrained(repo, **kwargs):
            seen["load"] = (repo, kwargs)
            return FakeModel()

    class FakeTensor:
        def __init__(self, a):
            self.shape = a.shape

        def unsqueeze(self, _):
            self.shape = (1, *self.shape)
            return self

    monkeypatch.setitem(sys.modules, "transformers", types.SimpleNamespace(AutoModel=FakeAutoModel))
    monkeypatch.setitem(sys.modules, "torch", types.SimpleNamespace(from_numpy=FakeTensor))
    engine = IndicConformerEngine()
    text, confidence = engine._decode(np.zeros(16000, dtype=np.float32), "gu")  # noqa: SLF001
    repo, kwargs = seen["load"]
    pin = ALL_PINNED["indicconformer"]
    assert (repo, kwargs["revision"], kwargs["trust_remote_code"]) == (pin.repo, pin.revision, True)
    assert seen["call"] == ((1, 16000), "gu", "ctc") and (text, confidence) == ("namaste", None)
    assert not engine.capabilities.keyterms and engine.version.endswith(pin.revision[:8])


# ------------------------------------------------------------------ faster-whisper
def test_faster_whisper_uses_cpu_int8_gu_and_reports_a_model_score(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "app.asr.fasterwhisper.REPO_ROOT", tmp_path
    )  # no local copy: use the pinned repo
    seen = {}

    class Seg:
        def __init__(self, text, lp):
            self.text, self.avg_logprob = text, lp

    class FakeWhisper:
        def __init__(self, repo, **kwargs):
            seen["init"] = (repo, kwargs)

        def transcribe(self, samples, **kwargs):
            seen["transcribe"] = kwargs
            return iter([Seg(" namaste", -0.1), Seg("doctor ", -0.3)]), object()

    monkeypatch.setitem(
        sys.modules, "faster_whisper", types.SimpleNamespace(WhisperModel=FakeWhisper)
    )
    engine = FasterWhisperEngine("small")
    text, confidence = engine._decode(np.zeros(16000, dtype=np.float32), "gu")  # noqa: SLF001
    pin = ALL_PINNED["whisper-small"]
    assert seen["init"] == (
        pin.repo,
        {"device": "cpu", "compute_type": "int8", "revision": pin.revision},
    )
    assert seen["transcribe"]["language"] == "gu" and text == "namaste doctor"
    assert confidence == pytest.approx((np.exp(-0.1) + np.exp(-0.3)) / 2, abs=1e-3)
    with pytest.raises(ValueError):
        FasterWhisperEngine("huge")


# ------------------------------------------------------------------ download command
def run_cli(argv, size=1_000_000_000, free=50_000_000_000, boom=False):
    lines, calls = [], []

    def fetch(_model):
        if boom:
            raise OSError("no network")
        return 12, size

    code = models_main(
        argv,
        fetch=fetch,
        download=lambda m, p: calls.append((m.repo, str(p))),
        free_bytes=lambda _p: free,
        out=lines.append,
    )
    return code, "\n".join(lines), calls


def test_download_prints_sizes_first_and_does_nothing_without_yes(tmp_path):
    code, text, calls = run_cli(["download", "whisper-small", "--dir", str(tmp_path / "w")])
    assert code == 0 and "12 files, 1000 MB" in text and "dry run" in text and calls == []


def test_download_refuses_when_there_is_not_enough_disk(tmp_path):
    code, text, calls = run_cli(
        ["download", "indicconformer", "--yes", "--dir", str(tmp_path)], free=2_000_000_000
    )
    assert code == 1 and "not enough free disk" in text and calls == []


def test_download_with_yes_downloads_only_the_pinned_model(tmp_path):
    code, _text, calls = run_cli(
        ["download", "whisper-small", "--yes", "--dir", str(tmp_path / "w")]
    )
    assert code == 0 and calls == [("Systran/faster-whisper-small", str(tmp_path / "w"))]
    assert run_cli(["download", "nope"])[0] == 2
    assert run_cli(["download", "whisper-small", "--yes"], boom=True)[0] == 1
