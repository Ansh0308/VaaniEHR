"""MockEngine: replays a fixture transcript, driven by how much audio has arrived. Used by tests and demos.

The fixture is a JSON list of {start_ms, end_ms, text, language?, speaker?}. A segment is emitted once the audio
received so far reaches its end_ms; with `partials=True` a few growing partials come first. No network, no models.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Sequence
from pathlib import Path

from app.asr.engine import ASREngine
from app.asr.types import BYTES_PER_MS, Capabilities, Segment, ms_of

# A short fake consultation for demos (made-up words; nothing clinical).
DEMO_SCRIPT: list[dict[str, object]] = [
    {"start_ms": 0, "end_ms": 1500, "text": "Namaste, tav kyarthi che", "language": "gu-IN"},
    {
        "start_ms": 1600,
        "end_ms": 3200,
        "text": "Drug-A twice a day for five days",
        "language": "en-IN",
    },
]


class MockEngine(ASREngine):
    name = "mock"
    version = "1.0"
    capabilities = Capabilities(
        streaming_partials=True,
        keyterms=True,
        codemix=True,
        diarization=False,
        confidence=False,
        word_timestamps=False,
    )

    def __init__(self, script: Sequence[dict[str, object]], partials: bool = True) -> None:
        super().__init__()
        self._script = list(script)
        self._partials = partials

    @classmethod
    def from_file(cls, path: str | Path, partials: bool = True) -> MockEngine:
        return cls(json.loads(Path(path).read_text(encoding="utf-8")), partials)

    async def transcribe_stream(
        self,
        audio_chunks: AsyncIterator[bytes],
        language_hint: str | None,
        keyterms: Sequence[str],
    ) -> AsyncIterator[Segment]:
        self._start_run(keyterms)
        received = 0
        index = 0
        async for chunk in audio_chunks:
            received += len(chunk)
            now_ms = ms_of(received)
            while index < len(self._script) and now_ms >= int(self._script[index]["end_ms"]):  # type: ignore[call-overload]
                for segment in self._segments_of(self._script[index], language_hint):
                    yield segment
                index += 1
        self.report.audio_seconds = received / (BYTES_PER_MS * 1000)
        # audio ended: flush what is left, the way a real engine finalises the last utterance
        while index < len(self._script):
            yield self._final(self._script[index], language_hint)
            index += 1

    def _final(self, item: dict[str, object], language_hint: str | None) -> Segment:
        return Segment(
            kind="final",
            start_ms=int(item["start_ms"]),  # type: ignore[call-overload]
            end_ms=int(item["end_ms"]),  # type: ignore[call-overload]
            text=str(item["text"]),
            language=(str(item["language"]) if item.get("language") else language_hint),
            speaker=(str(item["speaker"]) if item.get("speaker") else None),
            engine=self.name,
            engine_version=self.version,
        )

    def _segments_of(self, item: dict[str, object], language_hint: str | None) -> list[Segment]:
        final = self._final(item, language_hint)
        if not self._partials:
            return [final]
        words = final.text.split()
        steps = sorted({max(1, len(words) // 2), len(words)}) if len(words) > 1 else []
        partials = [
            Segment(
                kind="partial",
                start_ms=final.start_ms,
                end_ms=final.end_ms,
                text=" ".join(words[:count]),
                language=final.language,
                speaker=final.speaker,
                engine=self.name,
                engine_version=self.version,
            )
            for count in steps
            if count < len(words)
        ]
        return [*partials, final]
