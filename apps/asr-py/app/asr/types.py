"""Shared ASR types (FR-F2-07). Unknown facts are None; nothing here is ever guessed or faked."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

SAMPLE_RATE = 16_000
BYTES_PER_MS = SAMPLE_RATE * 2 // 1000  # 16 kHz mono 16-bit PCM = 32 bytes per millisecond


@dataclass(frozen=True)
class Segment:
    """One partial or final piece of transcript."""

    kind: Literal["partial", "final"]
    start_ms: int
    end_ms: int
    text: str
    engine: str
    engine_version: str
    #: language tag when the engine reports one for this segment, else None
    language: str | None = None
    #: "doctor" / "patient" / engine speaker id when known, else None
    speaker: str | None = None
    #: only when the engine really provides a score; Sarvam does not, so it is always None there
    confidence: float | None = None


@dataclass(frozen=True)
class Capabilities:
    """What an engine can honestly do. The UI and the experiment log use this, not assumptions."""

    streaming_partials: bool
    keyterms: bool
    codemix: bool
    diarization: bool
    confidence: bool
    word_timestamps: bool


@dataclass
class RunReport:
    """What happened in one transcription run (filled in by the engine while it runs)."""

    keyterms_requested: int = 0
    #: how many keyterms the engine actually used (0 when it cannot use them)
    keyterms_applied: int = 0
    audio_seconds: float = 0.0
    #: seconds the vendor says it billed (Sarvam session.end), None for local engines
    billed_seconds: float | None = None
    notes: list[str] = field(default_factory=list)


def ms_of(byte_count: int) -> int:
    return byte_count // BYTES_PER_MS
