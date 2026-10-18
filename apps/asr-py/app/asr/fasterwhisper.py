"""FasterWhisperEngine: faster-whisper (MIT) on CPU with int8 weights (docs/vendor-notes.md).

- Pinned CTranslate2 models from Systran (small by default; `medium` is larger and slower on CPU).
- `language="gu"`. Gujarati accuracy is NOT documented; this engine is a baseline for experiment 1, nothing more.
- Whisper does not take keyterms in this adapter (hotwords/prompt support is unverified): reported as ignored.
- `confidence` is exp(avg_logprob) of the segments, which faster-whisper returns: the geometric-mean token
  probability. It is a model score, not a calibrated chance of being right.
- faster-whisper is imported when the model is first used, so tests and CI never need it.
"""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np

from app.asr.local import UtteranceEngine
from app.asr.models import WHISPER_MODELS
from app.asr.types import Capabilities
from app.config import REPO_ROOT
from app.vad import EnergyBackend, VADBackend, VADConfig


class FasterWhisperEngine(UtteranceEngine):
    name = "faster-whisper"
    capabilities = Capabilities(
        streaming_partials=False,
        keyterms=False,
        codemix=False,
        diarization=False,
        confidence=True,
        word_timestamps=False,
    )

    def __init__(
        self,
        size: str = "small",
        vad_backend: Callable[[], VADBackend] = EnergyBackend,
        vad_config: VADConfig | None = None,
    ) -> None:
        super().__init__(vad_backend, vad_config)
        if size not in WHISPER_MODELS:
            raise ValueError(f"model size must be one of {sorted(WHISPER_MODELS)}")
        self._size = size
        self._pin = WHISPER_MODELS[size]
        self.version = f"{size}-int8-{self._pin.revision[:8]}"
        self._model: object | None = None

    def _load(self) -> object:
        from faster_whisper import WhisperModel  # noqa: PLC0415 - heavy, optional

        local = (
            REPO_ROOT / "data" / "models" / f"whisper-{self._size}"
        )  # made by app.models_cli download
        if local.exists():
            return WhisperModel(str(local), device="cpu", compute_type="int8")
        return WhisperModel(
            self._pin.repo, device="cpu", compute_type="int8", revision=self._pin.revision
        )

    def _decode(self, samples: np.ndarray, language: str | None) -> tuple[str, float | None]:
        if self._model is None:
            self._model = self._load()
        segments, _info = self._model.transcribe(  # type: ignore[attr-defined]
            samples, language=language or "gu", vad_filter=False, word_timestamps=False
        )
        parts = list(segments)
        if not parts:
            return "", None
        text = " ".join(p.text.strip() for p in parts)
        confidence = sum(math.exp(p.avg_logprob) for p in parts) / len(parts)
        return text, round(min(1.0, max(0.0, confidence)), 4)
