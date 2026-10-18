"""Base class for engines that decode a whole utterance at a time (IndicConformer, faster-whisper).

These engines have no streaming partials. The audio is cut into utterances by the VAD (so silence is never decoded),
each utterance is decoded in a worker thread, and one FINAL segment comes out per utterance with its real start and
end time. Keyterms are not supported by either model (nothing is documented): they are reported as ignored.
"""

from __future__ import annotations

import asyncio
from abc import abstractmethod
from collections.abc import AsyncIterator, Callable, Sequence

import numpy as np

from app.asr.engine import ASREngine
from app.asr.types import BYTES_PER_MS, Segment
from app.vad import EnergyBackend, SpeechSegmenter, VADBackend, VADConfig


class UtteranceEngine(ASREngine):
    #: the engine does its own voice-activity cutting, so the service must not trim the audio a second time
    own_vad = True

    def __init__(
        self,
        vad_backend: Callable[[], VADBackend] = EnergyBackend,
        vad_config: VADConfig | None = None,
    ) -> None:
        super().__init__()
        self._vad_backend = vad_backend
        self._vad_config = vad_config

    @abstractmethod
    def _decode(self, samples: np.ndarray, language: str | None) -> tuple[str, float | None]:
        """Blocking: (text, confidence or None) for 16 kHz mono float32 samples in [-1, 1]."""

    @staticmethod
    def _language_code(hint: str | None) -> str | None:
        return hint.split("-")[0].lower() if hint else None

    async def transcribe_stream(
        self,
        audio_chunks: AsyncIterator[bytes],
        language_hint: str | None,
        keyterms: Sequence[str],
    ) -> AsyncIterator[Segment]:
        self._start_run(keyterms)
        segmenter = SpeechSegmenter(self._vad_backend(), self._vad_config)
        received = 0
        language = self._language_code(language_hint)

        async def decode(utterances: list) -> list[Segment]:
            out = []
            for u in utterances:
                samples = np.frombuffer(u.pcm, dtype="<i2").astype(np.float32) / 32768.0
                text, confidence = await asyncio.to_thread(self._decode, samples, language)
                if text.strip():
                    out.append(
                        Segment(
                            kind="final",
                            start_ms=u.start_ms,
                            end_ms=u.end_ms,
                            text=text.strip(),
                            language=language_hint,
                            confidence=confidence,
                            engine=self.name,
                            engine_version=self.version,
                        )
                    )
            return out

        async for chunk in audio_chunks:
            received += len(chunk)
            for segment in await decode(segmenter.feed(chunk)):
                yield segment
        self.report.audio_seconds = received / (BYTES_PER_MS * 1000)
        for segment in await decode(segmenter.flush()):
            yield segment
