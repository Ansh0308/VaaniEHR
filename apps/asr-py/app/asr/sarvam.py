"""SarvamEngine: Sarvam's realtime speech-to-text WebSocket (docs/vendor-notes.md; page cited there).

- Model `saaras:v4`, `mode=codemix`, `return_timestamps=true`, 16 kHz linear16; keyterms (v4 only) travel as a
  JSON-encoded query parameter fixed at connect time.
- Sarvam documents NO per-segment confidence and no speaker on this endpoint, so those fields are always None.
  `language` is set only when Sarvam sends one (it does with language_code=auto) or the caller gave a hint.
- Partial results carry no timestamps: their start/end are the audio position (approximate). Final results use
  `start_s`/`end_s` when Sarvam sends them.
- Billing: `session.end.audio_duration_s` is stored as the billed seconds.
- Nothing is sent unless the own-voice rule allows it, and the monthly and per-run caps are checked BEFORE every send.
- The API key goes only into the connection header; it is never logged, put in a URL or in an error message.
Event bodies are not fully specified in the docs (only `event` and `text`); the parser accepts the fields at the top
level or under `data` and must be confirmed with the manual smoke test.
"""

from __future__ import annotations

import asyncio
import base64
import json
from collections.abc import AsyncIterator, Sequence
from typing import Any
from urllib.parse import quote, urlencode

from websockets.asyncio.client import connect
from websockets.exceptions import WebSocketException

from app.asr.engine import ASREngine
from app.asr.types import BYTES_PER_MS, Capabilities, Segment
from app.keyterms import validate_keyterms
from app.own_voice import ThirdPartyAudioRefused
from app.usage import CapExceeded, SpendGuard

DEFAULT_URL = "wss://api.sarvam.ai/speech-to-text-realtime/ws"
MODEL = "saaras:v4"
#: documented modes for saaras:v4 (docs/vendor-notes.md); the default stays codemix
MODES = ("transcribe", "translate", "verbatim", "translit", "codemix")


class SarvamError(Exception):
    """Sarvam or the connection failed. The message holds a short code, never the key or any audio."""


class SarvamEngine(ASREngine):
    name = "sarvam"
    version = MODEL
    capabilities = Capabilities(
        streaming_partials=True,
        keyterms=True,
        codemix=True,
        diarization=False,
        confidence=False,
        word_timestamps=False,
    )

    def __init__(
        self,
        api_key: str,
        *,
        spend: SpendGuard | None = None,
        allow_third_party: bool = False,
        own_voice_verified: bool = False,
        purpose: str = "stream",
        run_cap_seconds: float | None = None,
        url: str = DEFAULT_URL,
        mode: str = "codemix",
    ) -> None:
        super().__init__()
        if mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}")
        self._mode = mode
        self.version = MODEL if mode == "codemix" else f"{MODEL}/{mode}"
        self._key = api_key
        self._spend = spend
        self._allowed = allow_third_party or own_voice_verified
        self._purpose = purpose
        self._run_cap = run_cap_seconds
        self._url = url

    def _query(self, language_hint: str | None, keyterms: Sequence[str]) -> str:
        params = {
            "language_code": language_hint or "auto",
            "model": MODEL,
            "mode": self._mode,
            "encoding": "linear16",
            "sample_rate": "16000",
            "return_timestamps": "true",
        }
        if keyterms:
            params["keyterms"] = json.dumps(list(keyterms), ensure_ascii=False)
        return urlencode(params, quote_via=quote)

    async def transcribe_stream(
        self,
        audio_chunks: AsyncIterator[bytes],
        language_hint: str | None,
        keyterms: Sequence[str],
    ) -> AsyncIterator[Segment]:
        if not self._allowed:
            raise ThirdPartyAudioRefused(
                "audio that is not verified as the owner's own voice cannot be sent to Sarvam "
                "(SARVAM_ALLOW_THIRD_PARTY_AUDIO is false)"
            )
        terms = validate_keyterms(list(keyterms))
        self._start_run(terms)
        sent = 0  # bytes
        last_end = 0
        queue: asyncio.Queue[Segment | Exception | None] = asyncio.Queue()
        try:
            socket = await connect(
                f"{self._url}?{self._query(language_hint, terms)}",
                additional_headers={"api-subscription-key": self._key},
                max_size=1 << 20,
            )
        except (OSError, WebSocketException, TimeoutError):
            raise SarvamError("could not connect to Sarvam") from None

        def to_segment(kind: str, body: dict[str, Any]) -> Segment | None:
            nonlocal last_end
            data = body.get("data") if isinstance(body.get("data"), dict) else body
            text = str(data.get("text") or data.get("transcript") or "").strip()
            if not text:
                return None
            position = sent // BYTES_PER_MS
            if kind == "final" and data.get("end_s") is not None:
                start, end = (
                    int(float(data.get("start_s") or 0) * 1000),
                    int(float(data["end_s"]) * 1000),
                )
            else:
                start, end = last_end, position
            if kind == "final":
                last_end = end
            language = data.get("language") or language_hint
            return Segment(
                kind="final" if kind == "final" else "partial",
                start_ms=start,
                end_ms=max(end, start),
                text=text,
                language=str(language) if language else None,
                speaker=None,
                confidence=None,
                engine=self.name,
                engine_version=self.version,
            )

        async def read() -> None:
            try:
                async for raw in socket:
                    body = json.loads(raw)
                    event = body.get("event") or body.get("type")
                    if event in ("transcript.partial", "transcript.final"):
                        segment = to_segment(event.split(".")[1], body)
                        if segment:
                            await queue.put(segment)
                    elif event == "session.end":
                        data = body.get("data") if isinstance(body.get("data"), dict) else body
                        if data.get("audio_duration_s") is not None:
                            self.report.billed_seconds = float(data["audio_duration_s"])
                        break
                    elif event == "error":
                        data = body.get("data") if isinstance(body.get("data"), dict) else body
                        await queue.put(SarvamError(f"Sarvam error {data.get('code', 'unknown')}"))
                        break
            except (WebSocketException, ValueError, OSError):
                await queue.put(SarvamError("connection to Sarvam failed"))
            finally:
                await queue.put(None)

        reader = asyncio.create_task(read())
        try:
            async for chunk in audio_chunks:
                seconds_after = (sent + len(chunk)) / (BYTES_PER_MS * 1000)
                self._check_caps(seconds_after)
                await socket.send(
                    json.dumps({"event": "audio_input", "audio": base64.b64encode(chunk).decode()})
                )
                sent += len(chunk)
                while not queue.empty():
                    item = queue.get_nowait()
                    if isinstance(item, Exception):
                        raise item
                    if item is not None:
                        yield item
            self.report.audio_seconds = sent / (BYTES_PER_MS * 1000)
            await socket.send(json.dumps({"event": "end"}))
            while (item := await queue.get()) is not None:
                if isinstance(item, Exception):
                    raise item
                yield item
        finally:
            self.report.audio_seconds = sent / (BYTES_PER_MS * 1000)
            reader.cancel()
            await asyncio.gather(reader, return_exceptions=True)
            await socket.close()

    def _check_caps(self, run_seconds: float) -> None:
        if self._run_cap is not None and run_seconds > self._run_cap:
            raise CapExceeded(f"this run would pass its {self._run_cap:.0f} s cap")
        if self._spend is not None:
            self._spend.check(self.name, run_seconds, self._purpose)
