"""The audio WebSocket (ADR-D25): /ws/sessions/{session_id}/audio.

Protocol (plain WebSocket, not Socket.IO):
  1. The browser must send an allowed Origin header (checked before the connection is accepted).
  2. First message, within `start_timeout_seconds`, text JSON:
       {"type":"start","token":"<from api-node>","language":"gu-IN","keyterms":["..."],"engine":"mock"}
     The token travels here, never in the URL (URLs end up in logs). It must be valid, unused, for THIS session, and
     carry the consent scopes audio + ai_processing. Keyterms: at most 50, 64 characters each.
  3. Server answers {"type":"ready",...}; then the client sends binary frames of 16 kHz mono 16-bit PCM
     (at most `max_message_bytes` each). {"type":"ping"} is answered with {"type":"pong"}; {"type":"stop"} ends.
  4. Server events: {"type":"partial"|"final","segment":{...}}, {"type":"error","code":...}, {"type":"closed",...}.
Close codes: 1008 bad origin, 1009 message too big, 4400 bad request, 4401 token refused, 4403 consent withdrawn or
unverifiable, 4408 idle, 4429 spend cap, 4503 not configured, 1011 engine failure.
Consent is re-checked with api-node while the stream runs; if it is withdrawn (or cannot be checked three times in a
row) the stream stops and nothing is stored.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, replace
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from app.asr.engine import ASREngine
from app.asr.types import BYTES_PER_MS, Segment
from app.config import Settings
from app.consent import ConsentGuard, TokenError
from app.internal_api import InternalApiError, InternalApiPort
from app.storage import AudioStore, AudioStoreError
from app.usage import PAID_ENGINES, CapExceeded, SpendGuard, UsageLog
from app.vad import VADBackend, VadGate

MAX_KEYTERMS = 50
MAX_KEYTERM_CHARS = 64
MAX_STREAM_SECONDS = 3600


@dataclass
class Services:
    settings: Settings
    guard: ConsentGuard | None
    api: InternalApiPort | None
    store: AudioStore | None
    usage: UsageLog
    spend: SpendGuard
    #: engine name -> factory; only engines listed here can be chosen by a client
    engines: dict[str, Callable[[], ASREngine]]
    default_engine: str = "mock"
    start_timeout_seconds: float = 5.0
    idle_timeout_seconds: float = 15.0
    max_message_bytes: int = 32_768
    consent_recheck_seconds: float = 10.0
    #: makes a voice-activity backend per stream (None, or a factory that returns None, means no trimming)
    vad_factory: Callable[[], VADBackend | None] | None = None


def segment_json(s: Segment) -> dict[str, Any]:
    return {
        "kind": s.kind,
        "startMs": s.start_ms,
        "endMs": s.end_ms,
        "text": s.text,
        "language": s.language,
        "speaker": s.speaker,
        "confidence": s.confidence,
        "engine": s.engine,
        "engineVersion": s.engine_version,
    }


class _Stop(Exception):
    def __init__(self, code: int, reason: str) -> None:
        super().__init__(reason)
        self.code, self.reason = code, reason


async def _fail(ws: WebSocket, code: int, reason: str) -> None:
    with contextlib.suppress(Exception):
        await ws.send_json({"type": "error", "code": reason})
        await ws.close(code=code)


def _valid_start(message: dict[str, Any]) -> tuple[str, str | None, list[str], str | None]:
    token = message.get("token")
    language = message.get("language")
    terms = message.get("keyterms", [])
    engine = message.get("engine")
    if message.get("type") != "start" or not isinstance(token, str) or not token:
        raise _Stop(4400, "bad_start")
    if language is not None and (not isinstance(language, str) or len(language) > 12):
        raise _Stop(4400, "bad_language")
    if (
        not isinstance(terms, list)
        or len(terms) > MAX_KEYTERMS
        or any(not isinstance(t, str) or not t.strip() or len(t) > MAX_KEYTERM_CHARS for t in terms)
    ):
        raise _Stop(4400, "bad_keyterms")
    if engine is not None and not isinstance(engine, str):
        raise _Stop(4400, "bad_engine")
    return token, language, [t.strip() for t in terms], engine


def register(app: FastAPI, services: Services) -> None:
    cfg = services.settings

    @app.websocket("/ws/sessions/{session_id}/audio")
    async def audio(ws: WebSocket, session_id: str) -> None:
        origin = (ws.headers.get("origin") or "").rstrip("/")
        if origin not in cfg.allowed_origins:
            await ws.close(code=1008)  # before accept: the browser gets a refused handshake
            return
        await ws.accept()
        try:
            await _serve(ws, session_id)
        except _Stop as stop:
            await _fail(ws, stop.code, stop.reason)
        except WebSocketDisconnect:
            return

    async def _receive(ws: WebSocket, timeout: float) -> dict[str, Any]:
        try:
            message = await asyncio.wait_for(ws.receive(), timeout)
        except TimeoutError:
            raise _Stop(4408, "idle") from None
        if message["type"] == "websocket.disconnect":
            raise WebSocketDisconnect(message.get("code", 1000))
        return message

    async def _serve(ws: WebSocket, session_id: str) -> None:
        if services.guard is None or services.api is None:
            raise _Stop(4503, "not_configured")
        first = await _receive(ws, services.start_timeout_seconds)
        try:
            start = json.loads(first.get("text") or "")
        except ValueError:
            raise _Stop(4400, "bad_start") from None
        if not isinstance(start, dict):
            raise _Stop(4400, "bad_start")
        token, language, keyterms, requested = _valid_start(start)
        try:
            claims = services.guard.admit(token, expected_session=session_id)
        except TokenError as exc:
            raise _Stop(4401, exc.reason) from None
        name = requested or services.default_engine
        if name not in services.engines:
            raise _Stop(4400, "unknown_engine")
        engine = services.engines[name]()
        try:
            services.spend.check(engine.name, 1.0)
        except CapExceeded:
            raise _Stop(4429, "spend_cap") from None
        remaining = (
            services.spend.remaining_paid_seconds()
            if engine.name in PAID_ENGINES
            else float(MAX_STREAM_SECONDS)
        )

        request_id = str(uuid.uuid4())
        pcm = bytearray()
        queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        failure: list[_Stop] = []
        await ws.send_json(
            {
                "type": "ready",
                "engine": engine.name,
                "engineVersion": engine.version,
                "sampleRate": 16000,
            }
        )

        backend = services.vad_factory() if services.vad_factory else None
        # engines that cut utterances themselves must not be trimmed twice
        gate = (
            VadGate(backend)
            if backend is not None and not getattr(engine, "own_vad", False)
            else None
        )

        async def chunks() -> AsyncIterator[bytes]:
            while (item := await queue.get()) is not None:
                if gate is not None:
                    item = gate.push(
                        item
                    )  # silence is dropped before the engine (and its bill) sees it
                    if not item:
                        continue
                yield item

        finals_sent = 0

        async def pump() -> None:
            nonlocal finals_sent
            try:
                async for segment in engine.transcribe_stream(chunks(), language, keyterms):
                    if gate is not None:
                        segment = replace(
                            segment,
                            start_ms=gate.to_original_ms(segment.start_ms),
                            end_ms=gate.to_original_ms(segment.end_ms, end=True),
                        )
                    if segment.kind == "final":
                        finals_sent += 1
                    await ws.send_json({"type": segment.kind, "segment": segment_json(segment)})
            except WebSocketDisconnect:
                raise
            except Exception:  # noqa: BLE001 - any engine failure ends the stream the same way
                failure.append(_Stop(1011, "engine_failed"))

        async def watch_consent() -> None:
            misses = 0
            while True:
                await asyncio.sleep(services.consent_recheck_seconds)
                try:
                    status = await services.api.consent_status(session_id)  # type: ignore[union-attr]
                    misses = 0
                except InternalApiError:
                    misses += 1
                    if misses >= 3:
                        failure.append(_Stop(4403, "consent_unverifiable"))
                        return
                    continue
                scopes = status.get("scopes", {})
                if not (scopes.get("audio") and scopes.get("ai_processing")):
                    failure.append(_Stop(4403, "consent_withdrawn"))
                    return

        async def receive_audio() -> None:
            while True:
                message = await _receive(ws, services.idle_timeout_seconds)
                if message.get("bytes") is not None:
                    data: bytes = message["bytes"]
                    if len(data) > services.max_message_bytes:
                        raise _Stop(1009, "message_too_big")
                    if (len(pcm) + len(data)) / (BYTES_PER_MS * 1000) > min(
                        remaining, MAX_STREAM_SECONDS
                    ):
                        raise _Stop(4429, "spend_cap")
                    pcm.extend(data)
                    await queue.put(data)
                    continue
                try:
                    control = json.loads(message.get("text") or "")
                except ValueError:
                    raise _Stop(4400, "bad_message") from None
                kind = control.get("type") if isinstance(control, dict) else None
                if kind == "ping":
                    await ws.send_json({"type": "pong"})
                elif kind == "stop":
                    return
                else:
                    raise _Stop(4400, "bad_message")

        engine_task = asyncio.create_task(pump())
        consent_task = asyncio.create_task(watch_consent())
        audio_task = asyncio.create_task(receive_audio())
        stop: _Stop | None = None
        try:
            done, _ = await asyncio.wait(
                {audio_task, consent_task, engine_task}, return_when=asyncio.FIRST_COMPLETED
            )
            if failure:
                stop = failure[0]
            elif audio_task in done:
                audio_task.result()  # raises the _Stop / disconnect if that is why it ended
                await queue.put(None)  # normal stop: let the engine finish its last utterance
                await asyncio.wait_for(engine_task, 30)
                if failure:
                    stop = failure[0]
            elif engine_task in done and failure:
                stop = failure[0]
        except _Stop as exc:
            stop = exc
        except WebSocketDisconnect:
            stop = _Stop(1001, "client_left")
        finally:
            for task in (audio_task, consent_task, engine_task):
                task.cancel()
            await asyncio.gather(audio_task, consent_task, engine_task, return_exceptions=True)

        seconds = len(pcm) / (BYTES_PER_MS * 1000)
        if seconds > 0:
            services.usage.add(
                request_id=request_id,
                purpose="stream",
                session_id=claims.session_id,
                engine=engine.name,
                engine_version=engine.version,
                # what the engine actually received (less than the recording when silence was trimmed)
                audio_seconds=engine.report.audio_seconds or seconds,
                billed_seconds=engine.report.billed_seconds,
                keyterms_requested=engine.report.keyterms_requested,
                keyterms_applied=engine.report.keyterms_applied,
            )
        withdrawn = stop is not None and stop.reason in {
            "consent_withdrawn",
            "consent_unverifiable",
        }
        asset_id = None
        if services.store is not None and seconds > 0 and not withdrawn:
            try:
                asset = services.store.save(claims.session_id, bytes(pcm))
                asset_id = asset.id
                try:
                    await services.api.register_asset(asset)
                    asset.registered = True
                    services.store.update(asset)
                except InternalApiError:
                    pass  # the purge job registers it later
            except AudioStoreError:
                asset_id = None
        # content-free log line (no text, no audio): helps find out why a recording gave no transcript
        logging.getLogger("uvicorn.error").info(
            "audio stream ended: engine=%s received=%.1fs engine_got=%.1fs segments_sent=%d",
            engine.name,
            seconds,
            engine.report.audio_seconds,
            finals_sent,
        )
        pcm.clear()
        if stop is not None and stop.code != 1001:
            raise stop
        with contextlib.suppress(Exception):
            await ws.send_json(
                {
                    "type": "closed",
                    "audioSeconds": round(seconds, 3),
                    # what reached the engine after silence was trimmed (0 means no speech was detected)
                    "engineSeconds": round(engine.report.audio_seconds, 3),
                    "recordingId": asset_id,
                }
            )
            await ws.close(code=1000)
