"""The engine interface through MockEngine (FR-F2-04, FR-F2-07): no network, no models."""

from dataclasses import replace

import pytest

from app.asr.mock import MockEngine
from app.asr.types import BYTES_PER_MS, Segment
from tests.conftest import FIXTURES

pytestmark = pytest.mark.anyio


async def chunks(total_ms: int, chunk_ms: int = 250):
    for _ in range(total_ms // chunk_ms):
        yield bytes(chunk_ms * BYTES_PER_MS)


async def run(
    engine: MockEngine, total_ms: int, keyterms: tuple[str, ...] | list[str] = ()
) -> list[Segment]:
    return [s async for s in engine.transcribe_stream(chunks(total_ms), "gu-IN", list(keyterms))]


async def test_segments_carry_time_text_language_speaker_engine_and_version():
    engine = MockEngine.from_file(FIXTURES / "mock_transcript.json")
    finals = [s for s in await run(engine, 5000) if s.kind == "final"]
    assert [s.text for s in finals][0] == "Namaste, tav kyarthi che"
    first = finals[0]
    assert (first.start_ms, first.end_ms, first.language, first.speaker) == (
        0,
        1500,
        "gu-IN",
        "doctor",
    )
    assert (first.engine, first.engine_version) == ("mock", "1.0")
    assert first.confidence is None  # never invented


async def test_partials_come_before_their_final_and_grow():
    engine = MockEngine.from_file(FIXTURES / "mock_transcript.json")
    out = await run(engine, 5000)
    first_final = next(i for i, s in enumerate(out) if s.kind == "final")
    partials = out[:first_final]
    assert partials and all(p.kind == "partial" for p in partials)
    assert out[first_final].text.startswith(partials[-1].text)


async def test_a_segment_is_emitted_only_after_its_audio_has_arrived():
    engine = MockEngine.from_file(FIXTURES / "mock_transcript.json", partials=False)
    assert len(await run(engine, 1000)) == 3  # audio ended early: the rest is flushed at the end
    seen: list[int] = []
    async for segment in engine.transcribe_stream(chunks(5000), None, []):
        seen.append(segment.end_ms)
        assert segment.end_ms <= 5000
    assert seen == [1500, 3200, 4800]


async def test_report_counts_audio_and_keyterms():
    engine = MockEngine.from_file(FIXTURES / "mock_transcript.json")
    await run(engine, 5000, keyterms=["Drug-A", "Drug-B"])
    assert engine.report.audio_seconds == pytest.approx(5.0)
    assert (engine.report.keyterms_requested, engine.report.keyterms_applied) == (2, 2)


async def test_an_engine_without_keyterm_support_reports_them_as_ignored():
    class NoKeyterms(MockEngine):
        capabilities = replace(MockEngine.capabilities, keyterms=False)

    engine = NoKeyterms([])
    await run(engine, 500, keyterms=["Drug-A"])
    assert engine.report.keyterms_applied == 0
    assert "ignored" in engine.report.notes[0]
