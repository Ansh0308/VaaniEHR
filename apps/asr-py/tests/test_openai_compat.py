"""The real adapter against a fake local HTTP server (no real network, no real key)."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from app.extraction.openai_compat import (
    CachedProvider,
    OpenAICompatibleProvider,
    RequestBudget,
    RequestCapExceeded,
    ResponseCache,
)
from app.extraction.provider import ProviderError, RealDataRefused

pytestmark = pytest.mark.anyio
KEY = "sk-test-SECRET-123"


class Fake:
    def __init__(self, statuses: list[int], body: dict | None = None) -> None:
        self.statuses = statuses
        self.requests: list[dict] = []
        self.headers: list[dict] = []
        reply = body or {
            "model": "fake-model",
            "choices": [{"message": {"content": '{"facts": []}'}}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 3},
        }
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                length = int(self.headers.get("Content-Length", 0))
                outer.requests.append(json.loads(self.rfile.read(length)))
                outer.headers.append(dict(self.headers))
                status = outer.statuses.pop(0) if outer.statuses else 200
                payload = json.dumps(reply).encode() if status == 200 else b"{}"
                self.send_response(status)
                if status == 429:
                    self.send_header("Retry-After", "0")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args: object) -> None:
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}/v1"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


async def _nosleep(_: float) -> None:
    return None


def make(url: str, **kw: object) -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(url, "fake-model", KEY, True, sleep=_nosleep, **kw)  # type: ignore[arg-type]


async def test_sends_temperature_zero_json_format_and_bearer_key_and_parses_usage():
    fake = Fake([])
    try:
        out = await make(fake.url).complete("sys", "usr")
    finally:
        fake.close()
    body = fake.requests[0]
    assert body["temperature"] == 0
    assert body["response_format"] == {"type": "json_object"}
    assert body["messages"][1] == {"role": "user", "content": "usr"}
    assert fake.headers[0]["Authorization"] == f"Bearer {KEY}"
    assert (out.text, out.input_tokens, out.output_tokens) == ('{"facts": []}', 11, 3)


async def test_retries_on_429_and_5xx_then_succeeds_and_counts_each_attempt():
    fake = Fake([429, 503])
    provider = make(fake.url)
    try:
        out = await provider.complete("s", "u")
    finally:
        fake.close()
    assert out.text == '{"facts": []}'
    assert provider.requests_made == 3 and provider.budget.used == 3


async def test_gives_up_after_the_retries_and_error_text_has_no_key():
    fake = Fake([500, 500, 500, 500, 500])
    try:
        with pytest.raises(ProviderError) as info:
            await make(fake.url, max_retries=2).complete("s", "u")
    finally:
        fake.close()
    assert "500" in str(info.value) and KEY not in str(info.value)
    assert len(fake.requests) == 3


async def test_a_400_is_final_without_retry():
    fake = Fake([400, 200])
    try:
        with pytest.raises(ProviderError, match="400"):
            await make(fake.url).complete("s", "u")
    finally:
        fake.close()
    assert len(fake.requests) == 1


async def test_the_request_cap_stops_before_sending():
    fake = Fake([])
    provider = make(fake.url, budget=RequestBudget(2))
    try:
        await provider.complete("s", "1")
        await provider.complete("s", "2")
        with pytest.raises(RequestCapExceeded):
            await provider.complete("s", "3")
    finally:
        fake.close()
    assert len(fake.requests) == 2


async def test_unreachable_endpoint_is_a_provider_error_without_the_key():
    provider = make("http://127.0.0.1:1/v1", max_retries=0)
    with pytest.raises(ProviderError) as info:
        await provider.complete("s", "u")
    assert KEY not in str(info.value)


async def test_missing_content_gives_empty_text_and_bad_shape_is_an_error():
    fake = Fake([], {"choices": [{"message": {"content": None}}]})
    try:
        out = await make(fake.url).complete("s", "u")
    finally:
        fake.close()
    assert out.text == ""
    bad = Fake([], {"nope": 1})
    try:
        with pytest.raises(ProviderError, match="unexpected shape"):
            await make(bad.url).complete("s", "u")
    finally:
        bad.close()


async def test_cache_answers_a_repeat_without_a_request_and_is_keyed_by_model_and_prompt(tmp_path):
    fake = Fake([])
    inner = make(fake.url)
    cached = CachedProvider(inner, ResponseCache(tmp_path), "v1")
    try:
        a = await cached.complete("s", "u")
        b = await cached.complete("s", "u")
        await cached.complete("s", "other")
    finally:
        fake.close()
    assert a == b and cached.cache_hits == 1 and inner.requests_made == 2
    assert ResponseCache.key("m", "v1", "s", "u") != ResponseCache.key("m", "v2", "s", "u")
    assert ResponseCache.key("m", "v1", "s", "u") != ResponseCache.key("n", "v1", "s", "u")


def test_construction_rules():
    with pytest.raises(RealDataRefused, match="LLM_ALLOW_REAL_DATA"):
        OpenAICompatibleProvider("https://x.invalid/v1", "m", KEY, False)
    with pytest.raises(ProviderError) as info:
        OpenAICompatibleProvider("", "m", KEY, True)
    assert KEY not in str(info.value)
    with pytest.raises(ProviderError):
        OpenAICompatibleProvider("ftp://x", "m", KEY, True)


async def test_an_error_inside_a_200_reply_is_retried_like_its_status():
    fake = Fake([], {"error": {"code": 429, "message": "slow down"}})
    provider = make(fake.url, max_retries=1)
    try:
        with pytest.raises(ProviderError, match="429"):
            await provider.complete("s", "u")
    finally:
        fake.close()
    assert len(fake.requests) == 2
