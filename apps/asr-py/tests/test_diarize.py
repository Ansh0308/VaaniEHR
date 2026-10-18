"""Diarizer interface: off by default, post-call, unconfirmed until the doctor says who is who."""

import pytest

from app.asr.types import Segment
from app.diarize import (
    DiarizerUnavailable,
    MockDiarizer,
    NullDiarizer,
    SpeakerTurn,
    assign_speakers,
    build_diarizer,
    confirm_roles,
)

pytestmark = pytest.mark.anyio


def seg(start, end, text="x", speaker=None):
    return Segment("final", start, end, text, "mock", "1", speaker=speaker)


async def test_the_default_is_off_and_labels_nothing():
    assert isinstance(build_diarizer("off"), NullDiarizer)
    assert await NullDiarizer().diarize(b"") == []
    segments = [seg(0, 1000)]
    assert assign_speakers(segments, []) == segments


@pytest.mark.parametrize("name", ["pyannote", "sarvam-batch", "whatever"])
def test_diarizers_that_are_not_wired_say_so(name):
    with pytest.raises(DiarizerUnavailable, match="not available"):
        build_diarizer(name)


async def test_segments_get_the_turn_they_overlap_most_as_unconfirmed():
    turns = await MockDiarizer([SpeakerTurn(0, 1500, "0"), SpeakerTurn(1500, 4000, "1")]).diarize(
        b""
    )
    out = assign_speakers([seg(0, 1400), seg(1200, 3000), seg(5000, 6000)], turns)
    assert [s.speaker for s in out] == ["speaker:0", "speaker:1", None]


def test_the_doctor_confirms_who_is_who_and_only_then_do_roles_appear():
    labelled = [
        seg(0, 1, speaker="speaker:0"),
        seg(1, 2, speaker="speaker:1"),
        seg(2, 3, speaker="speaker:0"),
    ]
    out = confirm_roles(labelled, {"0": "doctor", "1": "patient"})
    assert [s.speaker for s in out] == ["doctor", "patient", "doctor"]
    assert [s.speaker for s in labelled] == [
        "speaker:0",
        "speaker:1",
        "speaker:0",
    ]  # the input is untouched


@pytest.mark.parametrize(
    "answer",
    [{"0": "doctor"}, {"0": "doctor", "1": "doctor"}, {"0": "doctor", "1": "nurse"}, {}],
)
def test_a_half_or_contradictory_answer_is_refused(answer):
    labelled = [seg(0, 1, speaker="speaker:0"), seg(1, 2, speaker="speaker:1")]
    with pytest.raises(ValueError):
        confirm_roles(labelled, answer)
