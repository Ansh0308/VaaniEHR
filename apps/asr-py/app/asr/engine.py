"""The ASR engine interface (FR-F2-04). Adapters live beside it; the rest of the service only sees this."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator, Sequence

from app.asr.types import Capabilities, RunReport, Segment


class ASREngine(ABC):
    """Audio in (16 kHz mono 16-bit PCM chunks), segments out.

    `transcribe_stream` is an async generator: it yields partial segments (when the engine can) and a final
    segment per utterance. `report` describes the latest run (audio seconds, keyterms used, billed seconds).
    """

    name: str
    version: str
    capabilities: Capabilities

    def __init__(self) -> None:
        self.report = RunReport()

    @abstractmethod
    def transcribe_stream(
        self,
        audio_chunks: AsyncIterator[bytes],
        language_hint: str | None,
        keyterms: Sequence[str],
    ) -> AsyncIterator[Segment]:
        """Yield segments for the audio. `language_hint` is a BCP-47 tag such as "gu-IN" or None for auto."""

    def _start_run(self, keyterms: Sequence[str]) -> None:
        """Resets the report. Keyterms are applied only if the engine supports them (reported either way)."""
        applied = len(keyterms) if self.capabilities.keyterms else 0
        self.report = RunReport(keyterms_requested=len(keyterms), keyterms_applied=applied)
        if keyterms and not self.capabilities.keyterms:
            self.report.notes.append(f"{self.name} cannot use keyterms: {len(keyterms)} ignored")
