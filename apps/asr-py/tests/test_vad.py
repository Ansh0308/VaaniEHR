"""VAD chunking with a deterministic energy backend (no torch, no models)."""

import numpy as np
import pytest

from app.asr.types import SAMPLE_RATE
from app.vad import FRAME_MS, EnergyBackend, SpeechSegmenter, VADConfig


def pcm(*parts: tuple[str, int]) -> bytes:
    """('s', ms) is a 440 Hz tone (speech stand-in); ('q', ms) is silence."""
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


def segment(audio: bytes, config: VADConfig | None = None, chunk: int | None = None):
    seg = SpeechSegmenter(EnergyBackend(), config)
    found = []
    step = chunk or len(audio) or 1
    for i in range(0, len(audio), step):
        found += seg.feed(audio[i : i + step])
    return found + seg.flush()


def test_cuts_one_utterance_with_padding_and_absolute_times():
    found = segment(pcm(("q", 1000), ("s", 1000), ("q", 1500)))
    assert len(found) == 1
    u = found[0]
    assert 850 <= u.start_ms <= 1000 and 2000 <= u.end_ms <= 2200
    assert len(u.pcm) == (u.end_ms - u.start_ms) * SAMPLE_RATE * 2 // 1000


def test_two_utterances_when_the_pause_is_long_enough_and_one_when_it_is_short():
    long_gap = segment(pcm(("s", 800), ("q", 900), ("s", 800), ("q", 800)))
    assert len(long_gap) == 2 and long_gap[0].end_ms < long_gap[1].start_ms
    short_gap = segment(pcm(("s", 800), ("q", 300), ("s", 800), ("q", 800)))
    assert len(short_gap) == 1


def test_a_blip_shorter_than_min_speech_is_dropped():
    assert segment(pcm(("q", 500), ("s", 100), ("q", 1000))) == []


def test_chunk_size_does_not_change_the_result():
    audio = pcm(("q", 400), ("s", 900), ("q", 900), ("s", 700), ("q", 700))
    whole = segment(audio)
    for chunk in (1, 333, 1000, 4097):
        assert segment(audio, chunk=chunk) == whole


def test_speech_at_the_very_end_is_returned_by_flush():
    found = segment(pcm(("q", 300), ("s", 1200)))
    assert len(found) == 1 and found[0].end_ms >= 1400


def test_a_very_long_utterance_is_split_at_the_maximum():
    found = segment(pcm(("s", 5000), ("q", 1000)), VADConfig(max_utterance_s=2.0))
    assert len(found) >= 2 and all((u.end_ms - u.start_ms) <= 2000 + FRAME_MS for u in found)


def test_silence_only_gives_nothing():
    assert segment(pcm(("q", 3000))) == []


@pytest.mark.parametrize(
    "bad",
    [
        {"threshold": 0.0},
        {"threshold": 1.0},
        {"threshold": 0.5, "neg_threshold": 0.9},
        {"min_silence_ms": -1},
        {"max_utterance_s": 0.5},
    ],
)
def test_bad_thresholds_are_refused(bad):
    with pytest.raises(ValueError):
        VADConfig(**bad)
