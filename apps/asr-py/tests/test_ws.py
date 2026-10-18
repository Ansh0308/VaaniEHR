"""The audio WebSocket end to end with MockEngine, a fake api-node and a temp folder. No network."""

import json
import os
import time
from datetime import UTC, datetime

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.asr.mock import MockEngine
from app.asr.types import BYTES_PER_MS
from app.config import Settings
from app.consent import ConsentGuard, sign
from app.main import create_app
from app.storage import AudioStore
from app.usage import SpendGuard, UsageLog
from app.ws import Services
from tests.conftest import FIXTURES
from tests.test_storage import FakeApi

SECRET = "s" * 40
SID = "5eed0000-0000-4000-8000-0000000000a1"
ORIGIN = "http://localhost:5173"
SCRIPT = json.loads((FIXTURES / "mock_transcript.json").read_text(encoding="utf-8"))


def token(**over):
    now = int(time.time())
    claims = {
        "v": 1, "aud": "asr-py", "sid": SID, "scopes": ["audio", "ai_processing"], "uid": "u", "cid": "c",
        "iat": now, "exp": now + 120, "jti": os.urandom(6).hex(),
    }  # fmt: skip
    return sign(SECRET, {**claims, **over})


class Env:
    def __init__(self, tmp_path, **over):
        self.api = FakeApi()
        self.usage = UsageLog(tmp_path / "usage.jsonl", clock=lambda: datetime.now(UTC))
        self.store = AudioStore(tmp_path / "audio", bytes(range(32)))
        self.services = Services(
            settings=Settings(),
            guard=ConsentGuard(SECRET),
            api=self.api,
            store=self.store,
            usage=self.usage,
            spend=SpendGuard(self.usage, monthly_cap_minutes=300, smoke_max_seconds=300),
            engines={"mock": lambda: MockEngine(SCRIPT)},
            default_engine="mock",
            start_timeout_seconds=1.0,
            idle_timeout_seconds=1.0,
            consent_recheck_seconds=0.05,
            **over,
        )
        self.client = TestClient(create_app(self.services))

    def connect(self, origin=ORIGIN, session=SID):
        headers = {"origin": origin} if origin else {}
        return self.client.websocket_connect(f"/ws/sessions/{session}/audio", headers=headers)


@pytest.fixture
def env(tmp_path):
    return Env(tmp_path)


def start(ws, **over):
    ws.send_text(json.dumps({"type": "start", "token": token(), "language": "gu-IN", **over}))
    return ws.receive_json()


def refused(env, first_message, origin=ORIGIN):
    """Opens, sends a first message, returns (error code, close code)."""
    with env.connect(origin) as ws:
        ws.send_text(first_message if isinstance(first_message, str) else json.dumps(first_message))
        error = ws.receive_json()
        with pytest.raises(WebSocketDisconnect) as info:
            ws.receive_json()
    return error["code"], info.value.code


def test_health_still_works(env):
    assert env.client.get("/health").json()["data"]["service"] == "asr-py"


@pytest.mark.parametrize(
    "origin", [None, "http://evil.example", "http://localhost:5173.evil.example"]
)
def test_a_bad_or_missing_origin_is_refused_before_anything_else(env, origin):
    with pytest.raises(WebSocketDisconnect) as info:
        with env.connect(origin):
            pass
    assert info.value.code == 1008


def test_the_first_message_must_be_a_valid_start(env):
    assert refused(env, "not json") == ("bad_start", 4400)
    assert refused(env, {"type": "audio"}) == ("bad_start", 4400)
    assert refused(env, {"type": "start"}) == ("bad_start", 4400)
    assert refused(env, {"type": "start", "token": token(), "keyterms": ["a"] * 51}) == (
        "bad_keyterms",
        4400,
    )
    assert refused(env, {"type": "start", "token": token(), "keyterms": ["x" * 65]}) == (
        "bad_keyterms",
        4400,
    )
    assert refused(env, {"type": "start", "token": token(), "engine": "nope"}) == (
        "unknown_engine",
        4400,
    )


def test_a_silent_client_is_dropped_at_the_start_timeout(env):
    with env.connect() as ws:
        assert ws.receive_json()["code"] == "idle"


@pytest.mark.parametrize(
    ("over", "reason"),
    [
        ({"sid": "another-session"}, "wrong_session"),
        ({"scopes": ["audio"]}, "missing_consent_scope"),
        ({"exp": 1, "iat": 0}, "expired"),
        ({"aud": "x"}, "wrong_audience"),
    ],
)
def test_a_token_that_is_not_for_this_session_with_both_scopes_is_refused(env, over, reason):
    msg = {"type": "start", "token": token(**over)}
    assert refused(env, msg) == (reason, 4401)


def test_a_token_works_once(env):
    t = token()
    with env.connect() as ws:
        ws.send_text(json.dumps({"type": "start", "token": t}))
        assert ws.receive_json()["type"] == "ready"
        ws.send_text('{"type":"stop"}')
    assert refused(env, {"type": "start", "token": t}) == ("already_used", 4401)


def test_streaming_returns_partials_and_finals_then_stores_encrypted_audio_and_logs_usage(env):
    chunk = bytes(250 * BYTES_PER_MS)
    seen = []
    with env.connect() as ws:
        ready = start(ws, keyterms=["Drug-A"])
        assert ready["type"] == "ready" and ready["engine"] == "mock"
        for _ in range(20):  # 5 seconds
            ws.send_bytes(chunk)
        ws.send_text('{"type":"ping"}')
        ws.send_text('{"type":"stop"}')
        while True:
            message = ws.receive_json()
            seen.append(message)
            if message["type"] == "closed":
                break
    finals = [m["segment"] for m in seen if m["type"] == "final"]
    assert [f["text"] for f in finals][0] == "Namaste, tav kyarthi che"
    assert finals[0]["confidence"] is None and finals[0]["engineVersion"] == "1.0"
    assert any(m["type"] == "partial" for m in seen) and any(m["type"] == "pong" for m in seen)
    closed = seen[-1]
    assert closed["audioSeconds"] == pytest.approx(5.0)
    assert env.store.load(closed["recordingId"]) == chunk * 20
    assert env.api.registered == [closed["recordingId"]]
    usage = env.usage.records()
    assert len(usage) == 1 and (usage[0].engine, usage[0].keyterms_applied) == ("mock", 1)


def test_a_frame_over_the_size_cap_closes_with_1009(env):
    with env.connect() as ws:
        start(ws)
        ws.send_bytes(bytes(env.services.max_message_bytes + 1))
        assert ws.receive_json()["code"] == "message_too_big"
        with pytest.raises(WebSocketDisconnect) as info:
            ws.receive_json()
    assert info.value.code == 1009


def test_an_idle_connection_is_closed(env):
    with env.connect() as ws:
        start(ws)
        assert ws.receive_json()["code"] == "idle"
        with pytest.raises(WebSocketDisconnect) as info:
            ws.receive_json()
    assert info.value.code == 4408


def test_consent_withdrawn_mid_stream_stops_it_and_stores_nothing(env):
    with env.connect() as ws:
        start(ws)
        ws.send_bytes(bytes(250 * BYTES_PER_MS))
        env.api.audio_on = False  # the patient withdraws
        message = ws.receive_json()
        while message["type"] not in {"error"}:
            message = ws.receive_json()
        assert message["code"] == "consent_withdrawn"
        with pytest.raises(WebSocketDisconnect) as info:
            ws.receive_json()
    assert info.value.code == 4403
    assert env.store.assets() == []


def test_when_consent_cannot_be_checked_it_fails_closed(env):
    with env.connect() as ws:
        start(ws)
        env.api.down = True
        message = ws.receive_json()
        while message["type"] != "error":
            message = ws.receive_json()
    assert message["code"] == "consent_unverifiable"


def test_a_paid_engine_is_refused_once_the_monthly_cap_is_used(tmp_path):
    env = Env(tmp_path)
    env.services.engines["sarvam"] = lambda: type("Paid", (MockEngine,), {"name": "sarvam"})([])
    env.usage.add(
        request_id="r",
        purpose="stream",
        engine="sarvam",
        engine_version="v",
        audio_seconds=300 * 60,
    )
    assert refused(env, {"type": "start", "token": token(), "engine": "sarvam"}) == (
        "spend_cap",
        4429,
    )


def test_an_engine_that_crashes_ends_the_stream_cleanly(tmp_path):
    class Broken(MockEngine):
        async def transcribe_stream(self, audio_chunks, language_hint, keyterms):
            raise RuntimeError("boom")
            yield  # pragma: no cover

    env = Env(tmp_path)
    env.services.engines["mock"] = lambda: Broken([])
    with env.connect() as ws:
        start(ws)
        message = ws.receive_json()
        while message["type"] != "error":
            message = ws.receive_json()
    assert message["code"] == "engine_failed"


def test_not_configured_means_not_available(tmp_path):
    env = Env(tmp_path)
    env.services.guard = None
    assert refused(env, {"type": "start", "token": token()}) == ("not_configured", 4503)


def test_silence_is_trimmed_before_the_engine_and_times_are_mapped_back(tmp_path):
    import numpy as np

    from app.asr.types import Capabilities, Segment
    from app.vad import EnergyBackend

    received = []

    class Probe(MockEngine):
        name, version = "probe", "0"
        capabilities = Capabilities(True, True, True, False, False, False)

        async def transcribe_stream(self, audio_chunks, language_hint, keyterms):
            self._start_run(keyterms)
            total = 0
            async for chunk in audio_chunks:
                total += len(chunk)
                received.append(len(chunk))
            self.report.audio_seconds = total / 32000
            yield Segment("final", 0, 400, "x", "probe", "0")

    def wave(ms, tone):
        n = 16 * ms
        a = 0.3 * np.sin(2 * np.pi * 440 * np.arange(n) / 16000) if tone else np.zeros(n)
        return (a * 32767).astype("<i2").tobytes()

    audio = wave(2000, False) + wave(600, True) + wave(2000, False)
    env = Env(tmp_path, vad_factory=EnergyBackend)
    env.services.engines["mock"] = lambda: Probe([])
    with env.connect() as ws:
        start(ws)
        for i in range(0, len(audio), 8000):
            ws.send_bytes(audio[i : i + 8000])
        ws.send_text('{"type":"stop"}')
        messages = []
        while (m := ws.receive_json())["type"] != "closed":
            messages.append(m)
    assert sum(received) < len(audio) * 0.5  # most of the silence never reached the engine
    final = next(m["segment"] for m in messages if m["type"] == "final")
    assert (
        1800 <= final["startMs"] <= 2000
    )  # trimmed time 0 maps to just before the tone in the recording
    usage = env.usage.records()[0]
    assert usage.audio_seconds == pytest.approx(sum(received) / 32000, abs=0.01)
