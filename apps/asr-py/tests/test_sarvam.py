"""SarvamEngine against a FAKE local WebSocket server: no network, no key, no paid call."""

import base64
import json
from datetime import UTC, datetime
from urllib.parse import parse_qs, urlparse

import pytest
from websockets.asyncio.server import serve

from app.asr.sarvam import SarvamEngine, SarvamError
from app.asr.types import BYTES_PER_MS
from app.keyterms import KeytermError, load_keyterms, validate_keyterms
from app.own_voice import ThirdPartyAudioRefused, sha256_of, verify_own_voice
from app.usage import CapExceeded, SpendGuard, UsageLog

pytestmark = pytest.mark.anyio
KEY = "test-key-NOT-REAL-0123456789"
CHUNK = bytes(250 * BYTES_PER_MS)


class FakeSarvam:
    """Records what the client sent and answers like the realtime API (shape per docs/vendor-notes.md)."""

    def __init__(self, fail_with: str | None = None) -> None:
        self.connections = 0
        self.headers: dict[str, str] = {}
        self.query: dict[str, list[str]] = {}
        self.audio_events = 0
        self.fail_with = fail_with

    async def handler(self, ws) -> None:
        self.connections += 1
        self.headers = dict(ws.request.headers)
        self.query = parse_qs(urlparse(ws.request.path).query)
        await ws.send(json.dumps({"event": "session.begin"}))
        async for raw in ws:
            msg = json.loads(raw)
            if msg["event"] == "audio_input":
                assert base64.b64decode(msg["audio"]) == CHUNK
                self.audio_events += 1
                if self.audio_events == 1:
                    if self.fail_with:
                        await ws.send(
                            json.dumps({"event": "error", "code": self.fail_with, "is_fatal": True})
                        )
                        return
                    await ws.send(json.dumps({"event": "transcript.partial", "text": "namaste"}))
            elif msg["event"] == "end":
                await ws.send(
                    json.dumps(
                        {
                            "event": "transcript.final",
                            "text": "namaste doctor",
                            "language": "gu-IN",
                            "start_s": 0.2,
                            "end_s": 1.4,
                        }  # fmt: skip
                    )
                )
                await ws.send(
                    json.dumps(
                        {"event": "session.end", "audio_duration_s": self.audio_events * 0.25}
                    )
                )
                return


@pytest.fixture
async def server():
    fake = FakeSarvam()
    async with serve(fake.handler, "127.0.0.1", 0) as srv:
        fake.url = f"ws://127.0.0.1:{srv.sockets[0].getsockname()[1]}/speech-to-text-realtime/ws"
        yield fake


async def audio(n: int):
    for _ in range(n):
        yield CHUNK


async def run(engine, n=2, hint="gu-IN", terms=()):
    return [s async for s in engine.transcribe_stream(audio(n), hint, list(terms))]


def engine(server, **kw):
    kw.setdefault("own_voice_verified", True)
    return SarvamEngine(KEY, url=server.url, **kw)


async def test_segments_have_times_language_and_never_a_confidence_or_speaker(server):
    e = engine(server)
    got = await run(e, terms=["Drug-A", "Drug-B"])
    partial, final = got[0], got[-1]
    assert (partial.kind, partial.text, partial.confidence, partial.speaker) == (
        "partial",
        "namaste",
        None,
        None,
    )
    assert (final.kind, final.start_ms, final.end_ms, final.language) == (
        "final",
        200,
        1400,
        "gu-IN",
    )
    assert (final.engine, final.engine_version, final.confidence, final.speaker) == (
        "sarvam",
        "saaras:v4",
        None,
        None,
    )
    assert e.report.billed_seconds == pytest.approx(
        0.5
    ) and e.report.audio_seconds == pytest.approx(0.5)
    assert (e.report.keyterms_requested, e.report.keyterms_applied) == (2, 2)


async def test_the_request_asks_for_v4_codemix_timestamps_and_the_keyterms(server):
    await run(engine(server), terms=["Drug-A", "Drug-B"])
    q = server.query
    assert (
        q["model"] == ["saaras:v4"]
        and q["mode"] == ["codemix"]
        and q["return_timestamps"] == ["true"]
    )
    assert q["language_code"] == ["gu-IN"] and q["sample_rate"] == ["16000"]
    assert json.loads(q["keyterms"][0]) == ["Drug-A", "Drug-B"]


async def test_the_key_is_in_the_header_only(server):
    await run(engine(server))
    assert server.headers["api-subscription-key"] == KEY
    assert KEY not in json.dumps(server.query)


async def test_unverified_audio_is_refused_before_any_connection(server):
    with pytest.raises(ThirdPartyAudioRefused):
        await run(engine(server, own_voice_verified=False))
    assert server.connections == 0 and server.audio_events == 0
    await run(
        engine(server, own_voice_verified=False, allow_third_party=True)
    )  # the owner's switch
    assert server.connections == 1


async def test_the_per_run_cap_stops_before_the_chunk_that_would_pass_it(server):
    with pytest.raises(CapExceeded):
        await run(engine(server, run_cap_seconds=0.6), n=4)
    assert (
        server.audio_events == 2
    )  # 0.25 + 0.25 = 0.5 s sent; the third chunk (0.75 s) was never sent


async def test_the_monthly_cap_stops_before_sending(server, tmp_path):
    log = UsageLog(tmp_path / "u.jsonl", clock=lambda: datetime.now(UTC))
    log.add(
        request_id="r",
        purpose="stream",
        engine="sarvam",
        engine_version="v",
        audio_seconds=299.9 * 60 / 60,
    )
    guard = SpendGuard(
        log, monthly_cap_minutes=5, smoke_max_seconds=300
    )  # 300 s allowed, 299.9 used
    with pytest.raises(CapExceeded):
        await run(
            engine(server, spend=guard), n=2
        )  # 0.25 s fits? 299.9 + 0.5 > 300 -> refused at the 2nd chunk
    assert server.audio_events <= 1


async def test_a_sarvam_error_event_becomes_a_clean_error_without_the_key(server):
    server.fail_with = "rate_limited"
    with pytest.raises(SarvamError) as info:
        await run(engine(server))
    assert "rate_limited" in str(info.value) and KEY not in str(info.value)


async def test_a_server_that_is_not_there_gives_a_clean_error():
    e = SarvamEngine(KEY, url="ws://127.0.0.1:9/x", own_voice_verified=True)
    with pytest.raises(SarvamError) as info:
        await run(e)
    assert KEY not in str(info.value)


def test_keyterm_limits_are_enforced_and_a_missing_file_means_none(tmp_path):
    assert len(validate_keyterms([f"Drug-{i}" for i in range(50)])) == 50
    for bad in ([f"d{i}" for i in range(51)], ["x" * 65], [""], ["Dup", "dup"]):
        with pytest.raises(KeytermError):
            validate_keyterms(bad)
    f = tmp_path / "k.txt"
    f.write_text("# status: unreviewed\nDrug-A\n\nDrug-B\n", encoding="utf-8")
    assert load_keyterms(f) == ["Drug-A", "Drug-B"] and load_keyterms(tmp_path / "none.txt") == []


def test_only_a_listed_unchanged_file_inside_audio_own_passes(tmp_path):
    own = tmp_path / "audio" / "own"
    own.mkdir(parents=True)
    clip, other = own / "clip01.wav", tmp_path / "elsewhere.wav"
    clip.write_bytes(b"RIFF1234")
    other.write_bytes(b"RIFF1234")
    with pytest.raises(ThirdPartyAudioRefused, match="manifest.json is missing"):
        verify_own_voice(clip, own)
    manifest = own / "manifest.json"
    manifest.write_text(
        json.dumps({"files": {"clip01.wav": {"voice": "owner", "sha256": sha256_of(clip)}}})
    )
    verify_own_voice(clip, own)  # passes
    with pytest.raises(ThirdPartyAudioRefused, match="not inside audio/own"):
        verify_own_voice(other, own)
    clip.write_bytes(b"RIFF9999")
    with pytest.raises(ThirdPartyAudioRefused, match="changed after"):
        verify_own_voice(clip, own)
    manifest.write_text(
        json.dumps({"files": {"clip01.wav": {"voice": "patient", "sha256": sha256_of(clip)}}})
    )
    with pytest.raises(ThirdPartyAudioRefused, match='"voice": "owner"'):
        verify_own_voice(clip, own)
