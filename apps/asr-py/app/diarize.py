"""Speaker labelling AFTER the call, confirmed by the doctor (owner decision 2026-10-17; PRD_ERRATA 40).

No documented streaming API labels speakers (docs/vendor-notes.md), so labels are worked out once the recording has
ended. A diarizer only says "speaker 0 spoke from A to B"; it never knows who is the doctor. Until the doctor confirms
who is who, a segment's `speaker` is the raw id `speaker:<n>` (unconfirmed); after `confirm_roles` it is `doctor` or
`patient`. The default is OFF (`NullDiarizer`). pyannote and Sarvam's batch diarization are not wired in 4A
(pyannote is gated and is not installed; Sarvam batch needs the terms settled first), asking for them says so.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace

from app.asr.types import Segment

ROLES = frozenset({"doctor", "patient"})
UNCONFIRMED_PREFIX = "speaker:"


@dataclass(frozen=True)
class SpeakerTurn:
    start_ms: int
    end_ms: int
    #: the diarizer's own id ("0", "1", ...)
    speaker: str


class Diarizer(ABC):
    name: str

    @abstractmethod
    async def diarize(self, pcm: bytes, num_speakers: int | None = None) -> list[SpeakerTurn]:
        """Speaker turns for a finished recording (16 kHz mono 16-bit PCM)."""


class NullDiarizer(Diarizer):
    """The default: no labels."""

    name = "off"

    async def diarize(self, pcm: bytes, num_speakers: int | None = None) -> list[SpeakerTurn]:
        return []


class MockDiarizer(Diarizer):
    """Returns fixed turns (tests and demos)."""

    name = "mock"

    def __init__(self, turns: Sequence[SpeakerTurn]) -> None:
        self._turns = list(turns)

    async def diarize(self, pcm: bytes, num_speakers: int | None = None) -> list[SpeakerTurn]:
        return list(self._turns)


class DiarizerUnavailable(Exception):
    """The requested diarizer is not available in this build."""


def build_diarizer(name: str) -> Diarizer:
    if name in ("", "off"):
        return NullDiarizer()
    if name == "mock":
        return MockDiarizer([])
    raise DiarizerUnavailable(
        f"diarizer '{name}' is not available in Phase 4A (pyannote is gated and not installed; "
        "Sarvam batch diarization waits for the terms check): use 'off'"
    )


def assign_speakers(segments: Sequence[Segment], turns: Sequence[SpeakerTurn]) -> list[Segment]:
    """Gives each final segment the turn it overlaps most as `speaker:<id>` (unconfirmed). No overlap: unchanged."""
    out: list[Segment] = []
    for segment in segments:
        best, best_overlap = None, 0
        for turn in turns:
            overlap = min(segment.end_ms, turn.end_ms) - max(segment.start_ms, turn.start_ms)
            if overlap > best_overlap:
                best, best_overlap = turn, overlap
        out.append(
            replace(segment, speaker=f"{UNCONFIRMED_PREFIX}{best.speaker}") if best else segment
        )
    return out


def confirm_roles(segments: Sequence[Segment], roles: Mapping[str, str]) -> list[Segment]:
    """Applies the doctor's answer, e.g. {"0": "doctor", "1": "patient"}.

    Every speaker found in the segments must be answered, only doctor/patient are allowed, and two speakers cannot
    both be the doctor (or both the patient): a half-confirmed or contradictory answer is refused, nothing changes.
    """
    present = {s.speaker[len(UNCONFIRMED_PREFIX) :] for s in segments if _unconfirmed(s)}
    if present - set(roles):
        raise ValueError("every speaker must be assigned a role")
    chosen = {roles[sp] for sp in present}
    if not chosen <= ROLES or len(chosen) != len(present):
        raise ValueError("roles must be 'doctor' or 'patient', one per speaker")
    return [
        replace(s, speaker=roles[s.speaker[len(UNCONFIRMED_PREFIX) :]]) if _unconfirmed(s) else s
        for s in segments
    ]


def _unconfirmed(segment: Segment) -> bool:
    return bool(segment.speaker and segment.speaker.startswith(UNCONFIRMED_PREFIX))
