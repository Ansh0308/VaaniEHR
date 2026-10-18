"""The real language-model adapter: an OpenAI-compatible chat-completions endpoint (ADR-D31).

Configured ONLY by LLM_BASE_URL, LLM_MODEL and LLM_API_KEY (plus limits). The key is sent as a bearer header and is never
logged, printed or put in an error. Standard library only (no extra dependency).
- temperature 0, JSON output requested (`response_format`), the reply is schema-checked later by the pipeline;
- retries with exponential backoff on 429 and 5xx and on network errors (Retry-After is honoured, capped at 30 s);
  other 4xx answers are final;
- small concurrency (a semaphore) and a HARD per-run request cap (default 60): the request that would pass it is refused
  before it is sent. Free models cost nothing but their requests still count against the cap and the monthly cap;
- a local cache of raw replies in a git-ignored folder, keyed by (model, prompt version, input hash): a rerun of the same
  input never calls the API again (a cache hit is not a request);
- refuses to be built unless LLM_ALLOW_REAL_DATA=true.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import urllib.error
import urllib.request
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from app.extraction.provider import (
    LlmResponse,
    ProviderError,
    RealDataRefused,
    approx_tokens,
)

RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_RETRY_AFTER_SECONDS = 30.0


class RequestCapExceeded(ProviderError):
    """The per-run request cap would be passed. Nothing was sent."""


@dataclass
class RequestBudget:
    """Counts HTTP requests of one run (cache hits are not requests)."""

    limit: int
    used: int = 0

    def take(self) -> None:
        if self.used >= self.limit:
            raise RequestCapExceeded(f"this run reached its limit of {self.limit} requests")
        self.used += 1


class OpenAICompatibleProvider:
    name = "openai_compatible"
    paid = True  # requests are counted and capped even when the model is free

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str,
        allow_real_data: bool,
        *,
        budget: RequestBudget | None = None,
        concurrency: int = 2,
        max_retries: int = 3,
        timeout: float = 120.0,
        max_tokens: int = 4096,
        response_format: str = "json_object",
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if not allow_real_data:
            raise RealDataRefused(
                "LLM_ALLOW_REAL_DATA is false: free or hosted endpoints may log prompts, so this provider will not "
                "run. Set it to true only for simulated test data, or once the provider's no-training terms are confirmed."
            )
        if not (base_url and model and api_key):
            raise ProviderError("LLM_BASE_URL, LLM_MODEL and LLM_API_KEY must all be set")
        if urlparse(base_url).scheme not in ("http", "https"):
            raise ProviderError("LLM_BASE_URL must start with http:// or https://")
        if response_format not in ("json_object", "none"):
            raise ProviderError("LLM_RESPONSE_FORMAT must be json_object or none")
        self.model = model
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._key = api_key
        self.budget = budget or RequestBudget(60)
        self._sem = asyncio.Semaphore(max(1, concurrency))
        self._retries = max_retries
        self._timeout = timeout
        self._max_tokens = max_tokens
        self._format = response_format
        self._sleep = sleep
        self._openrouter = (urlparse(base_url).hostname or "").endswith("openrouter.ai")
        self.requests_made = 0

    def _body(self, system: str, user: str) -> bytes:
        body: dict[str, object] = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0,
            "max_tokens": self._max_tokens,
        }
        if self._format == "json_object":
            body["response_format"] = {"type": "json_object"}
        if self._openrouter:
            body["reasoning"] = {"exclude": True}  # reasoning text is not wanted in the reply
        return json.dumps(body).encode("utf-8")

    def _post(self, payload: bytes) -> tuple[int, dict[str, str], bytes]:
        request = urllib.request.Request(  # noqa: S310 - the URL comes from our own configuration
            self._url,
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self._key}"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:  # noqa: S310
                return response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as exc:
            return exc.code, dict(exc.headers or {}), b""
        except (urllib.error.URLError, TimeoutError, OSError):
            return -1, {}, b""

    async def complete(self, system: str, user: str) -> LlmResponse:
        payload = self._body(system, user)
        async with self._sem:
            for attempt in range(self._retries + 1):
                self.budget.take()  # every attempt is a request and counts against the cap
                self.requests_made += 1
                status, headers, raw = await asyncio.to_thread(self._post, payload)
                if status == 200:
                    status = (
                        self._embedded_error(raw) or 200
                    )  # OpenRouter may send an error inside a 200
                if status == 200:
                    return self._parse(raw, system, user)
                retryable = status in RETRY_STATUS or status == -1
                if not retryable or attempt == self._retries:
                    # the message names the status only: never the key, the prompt or the body
                    raise ProviderError(
                        "the language-model endpoint could not be reached"
                        if status == -1
                        else f"the language-model endpoint answered HTTP {status}"
                    )
                delay = min(2.0**attempt, MAX_RETRY_AFTER_SECONDS)
                retry_after = {k.lower(): v for k, v in headers.items()}.get("retry-after")
                if retry_after and retry_after.replace(".", "", 1).isdigit():
                    delay = min(float(retry_after), MAX_RETRY_AFTER_SECONDS)
                await self._sleep(delay)
        raise ProviderError("unreachable")  # pragma: no cover

    @staticmethod
    def _embedded_error(raw: bytes) -> int | None:
        try:
            error = json.loads(raw).get("error")
        except (ValueError, AttributeError):
            return None
        if not isinstance(error, dict):
            return None
        code = error.get("code")
        return code if isinstance(code, int) and code >= 400 else 502

    def _parse(self, raw: bytes, system: str, user: str) -> LlmResponse:
        try:
            data = json.loads(raw)
            message = data["choices"][0]["message"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise ProviderError(
                "the language-model endpoint sent a reply in an unexpected shape"
            ) from None
        content = message.get("content")
        text = (
            content if isinstance(content, str) else ""
        )  # a model that spent its tokens thinking gives no content
        usage = data.get("usage") or {}
        return LlmResponse(
            text,
            str(data.get("model") or self.model),
            int(usage.get("prompt_tokens") or approx_tokens(system + user)),
            int(usage.get("completion_tokens") or approx_tokens(text)),
        )


class ResponseCache:
    """Raw replies on disk, git-ignored (under data/). Key = SHA-256 of (model, prompt version, input hash)."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory

    @staticmethod
    def key(model: str, prompt_version: str, system: str, user: str) -> str:
        inputs = hashlib.sha256((system + "\0" + user).encode("utf-8")).hexdigest()
        return hashlib.sha256(f"{model}\0{prompt_version}\0{inputs}".encode()).hexdigest()

    def get(self, key: str) -> LlmResponse | None:
        path = self.directory / f"{key}.json"
        if not path.exists():
            return None
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
            return LlmResponse(
                d["text"], d["model"], int(d["input_tokens"]), int(d["output_tokens"])
            )
        except (ValueError, KeyError, TypeError):
            return None

    def put(self, key: str, response: LlmResponse) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.directory / f"{key}.json", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(
                {
                    "text": response.text,
                    "model": response.model,
                    "input_tokens": response.input_tokens,
                    "output_tokens": response.output_tokens,
                },
                handle,
                ensure_ascii=False,
            )


class CachedProvider:
    """Wraps any provider: a repeated input is answered from the cache and costs no request."""

    def __init__(self, inner: object, cache: ResponseCache, prompt_version: str) -> None:
        self._inner = inner
        self._cache = cache
        self._version = prompt_version
        self.name = inner.name  # type: ignore[attr-defined]
        self.model = inner.model  # type: ignore[attr-defined]
        self.paid = inner.paid  # type: ignore[attr-defined]
        self.cache_hits = 0

    async def complete(self, system: str, user: str) -> LlmResponse:
        key = ResponseCache.key(self.model, self._version, system, user)
        cached = self._cache.get(key)
        if cached is not None:
            self.cache_hits += 1
            return cached
        response = await self._inner.complete(system, user)  # type: ignore[attr-defined]
        self._cache.put(key, response)
        return response

    def __getattr__(self, item: str) -> object:
        return getattr(self._inner, item)
