"""Voice-activity chunking (FR-F2-02): cut a PCM stream into utterances before it goes to an engine.

The segmenter is plain Python/numpy and takes any `VADBackend`. `SileroBackend` is the real one (it loads the
`silero-vad` package lazily, so the service and the tests run without torch); tests use `EnergyBackend`.
Audio is 16 kHz mono 16-bit PCM. Silero needs exactly 512-sample frames, so frames are 32 ms.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from app.asr.types import SAMPLE_RATE

FRAME_SAMPLES = 512
FRAME_MS = FRAME_SAMPLES * 1000 // SAMPLE_RATE  # 32 ms
FRAME_BYTES = FRAME_SAMPLES * 2


@dataclass(frozen=True)
class VADConfig:
    """Thresholds (configurable; defaults follow the silero-vad VADIterator defaults where it has them)."""

    threshold: float = 0.5
    #: below this the frame counts as silence; default threshold - 0.15 (silero-vad's own rule)
    neg_threshold: float | None = None
    min_speech_ms: int = 250
    min_silence_ms: int = 500
    speech_pad_ms: int = 100
    max_utterance_s: float = 30.0

    def __post_init__(self) -> None:
        if not 0.0 < self.threshold < 1.0:
            raise ValueError("threshold must be between 0 and 1")
        if self.neg_threshold is not None and not 0.0 < self.neg_threshold <= self.threshold:
            raise ValueError("neg_threshold must be between 0 and threshold")
        if min(self.min_speech_ms, self.min_silence_ms, self.speech_pad_ms) < 0:
            raise ValueError("durations cannot be negative")
        if self.max_utterance_s < 1:
            raise ValueError("max_utterance_s must be at least 1")

    @property
    def low(self) -> float:
        return (
            self.neg_threshold
            if self.neg_threshold is not None
            else max(self.threshold - 0.15, 0.01)
        )


@dataclass(frozen=True)
class Utterance:
    start_ms: int
    end_ms: int
    pcm: bytes


class VADBackend(Protocol):
    def probability(self, frame: np.ndarray) -> float:
        """Speech probability (0..1) of one float32 frame of FRAME_SAMPLES samples in [-1, 1]."""

    def reset(self) -> None: ...


class EnergyBackend:
    """A deterministic stand-in for tests and demos: speech when the frame's RMS level is above `level`."""

    def __init__(self, level: float = 0.02) -> None:
        self.level = level

    def probability(self, frame: np.ndarray) -> float:
        return 1.0 if float(np.sqrt(np.mean(frame**2))) >= self.level else 0.0

    def reset(self) -> None:
        return None


class SileroBackend:
    """Silero VAD (MIT). Needs `pip install -r requirements-vad.txt` (brings torch); imported only when used."""

    def __init__(self) -> None:
        try:
            import torch  # noqa: PLC0415
            from silero_vad import load_silero_vad  # noqa: PLC0415
        except ImportError as exc:  # pragma: no cover - depends on the optional install
            raise RuntimeError(
                "silero-vad is not installed: pip install -r requirements-vad.txt"
            ) from exc
        self._torch = torch
        self._model = load_silero_vad()

    def probability(self, frame: np.ndarray) -> float:
        return float(self._model(self._torch.from_numpy(frame), SAMPLE_RATE).item())

    def reset(self) -> None:
        self._model.reset_states()


class SpeechSegmenter:
    """Feed PCM in any chunk size; get finished utterances. Call `flush()` when the audio ends."""

    def __init__(self, backend: VADBackend, config: VADConfig | None = None) -> None:
        self._backend = backend
        self._cfg = config or VADConfig()
        self._pad_frames = -(-self._cfg.speech_pad_ms // FRAME_MS)
        self._silence_frames = max(1, -(-self._cfg.min_silence_ms // FRAME_MS))
        self._min_frames = max(1, -(-self._cfg.min_speech_ms // FRAME_MS))
        self._max_frames = int(self._cfg.max_utterance_s * 1000 // FRAME_MS)
        self._carry = b""
        self._index = 0  # index of the next frame
        self._pre: deque[tuple[int, bytes]] = deque(maxlen=self._pad_frames)
        self._active: list[tuple[int, bytes]] | None = None
        self._speech_frames = 0
        self._quiet_run = 0
        self._backend.reset()

    def feed(self, pcm: bytes) -> list[Utterance]:
        data = self._carry + pcm
        usable = len(data) - len(data) % FRAME_BYTES
        self._carry = data[usable:]
        out: list[Utterance] = []
        for offset in range(0, usable, FRAME_BYTES):
            done = self._frame(data[offset : offset + FRAME_BYTES])
            if done is not None:
                out.append(done)
        return out

    def flush(self) -> list[Utterance]:
        done = self._close() if self._active is not None else None
        self._carry = b""
        return [done] if done is not None else []

    def _frame(self, raw: bytes) -> Utterance | None:
        idx = self._index
        self._index += 1
        samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        p = self._backend.probability(samples)
        if self._active is None:
            if p >= self._cfg.threshold:
                self._active = [*self._pre, (idx, raw)]
                self._pre.clear()
                self._speech_frames = 1
                self._quiet_run = 0
            else:
                self._pre.append((idx, raw))
            return None
        self._active.append((idx, raw))
        if p >= self._cfg.low:
            self._speech_frames += 1
            self._quiet_run = 0
        else:
            self._quiet_run += 1
        if self._quiet_run >= self._silence_frames or len(self._active) >= self._max_frames:
            return self._close()
        return None

    def _close(self) -> Utterance | None:
        frames = self._active or []
        self._active = None
        speech = self._speech_frames
        quiet = self._quiet_run
        self._speech_frames = 0
        self._quiet_run = 0
        self._backend.reset()
        if quiet:  # keep only the padding after the last speech
            keep = max(0, len(frames) - quiet + self._pad_frames)
            frames = frames[:keep]
        if not frames or speech < self._min_frames:
            return None
        return Utterance(
            start_ms=frames[0][0] * FRAME_MS,
            end_ms=(frames[-1][0] + 1) * FRAME_MS,
            pcm=b"".join(raw for _, raw in frames),
        )


class VadGate:
    """Streaming silence trimmer for engines that take a continuous stream (Sarvam, the mock).

    `push` returns only the audio worth sending: speech, a little before it (pre-roll) and a hang time after it.
    Silence is dropped, which also cuts the billed seconds. The engine therefore sees a SHORTER timeline;
    `to_original_ms` turns an engine time back into time in the original recording.
    """

    def __init__(self, backend: VADBackend, config: VADConfig | None = None) -> None:
        self._backend = backend
        self._cfg = config or VADConfig()
        self._pad_frames = -(-self._cfg.speech_pad_ms // FRAME_MS)
        self._hang_frames = max(1, -(-self._cfg.min_silence_ms // FRAME_MS))
        self._carry = b""
        self._index = 0
        self._pre: deque[tuple[int, bytes]] = deque(maxlen=self._pad_frames)
        self._open = False
        self._quiet = 0
        self._sent_frames = 0
        #: (start in the trimmed timeline, start in the original timeline) of every block that was sent
        self._blocks: list[tuple[int, int]] = []
        self._backend.reset()

    @property
    def sent_ms(self) -> int:
        return self._sent_frames * FRAME_MS

    def push(self, pcm: bytes) -> bytes:
        data = self._carry + pcm
        usable = len(data) - len(data) % FRAME_BYTES
        self._carry = data[usable:]
        out: list[bytes] = []
        for offset in range(0, usable, FRAME_BYTES):
            raw = data[offset : offset + FRAME_BYTES]
            idx = self._index
            self._index += 1
            p = self._backend.probability(
                np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
            )
            if not self._open:
                if p >= self._cfg.threshold:
                    frames = [*self._pre, (idx, raw)]
                    self._pre.clear()
                    self._blocks.append((self._sent_frames * FRAME_MS, frames[0][0] * FRAME_MS))
                    self._open, self._quiet = True, 0
                    out.extend(r for _, r in frames)
                    self._sent_frames += len(frames)
                else:
                    self._pre.append((idx, raw))
                continue
            out.append(raw)
            self._sent_frames += 1
            self._quiet = 0 if p >= self._cfg.low else self._quiet + 1
            if self._quiet >= self._hang_frames:
                self._open = False
                self._backend.reset()
        return b"".join(out)

    def to_original_ms(self, trimmed_ms: int, end: bool = False) -> int:
        """Time in the original recording for a time in the trimmed stream (`end=True` for the end of a segment)."""
        if not self._blocks:
            return trimmed_ms
        probe = max(0, trimmed_ms - 1) if end else trimmed_ms
        start_trim, start_orig = self._blocks[0]
        for block in self._blocks:
            if block[0] <= probe:
                start_trim, start_orig = block
        return start_orig + (probe - start_trim) + (1 if end and trimmed_ms > 0 else 0)
