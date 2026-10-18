"""Language-model providers (ADR-D29). The pipeline talks to this interface only.

- MockProvider (the default): canned replies, including bad JSON, wrong types, ungrounded facts and obedience to
  injected instructions, so every defence is tested without a network or a key. Costs nothing.
- OpenAICompatibleProvider (openai_compat.py): a chat-completions client configured ONLY by LLM_BASE_URL, LLM_MODEL and
  LLM_API_KEY, with retries, a request cap and a local reply cache. It refuses to run unless LLM_ALLOW_REAL_DATA=true.
Provider and model come from environment variables (LLM_PROVIDER, LLM_MODEL). The model never receives patient,
clinic or user data: only segment labels and text (see pipelines.build_user_prompt).
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class LlmResponse:
    text: str
    model: str
    input_tokens: int
    output_tokens: int


class ProviderError(Exception):
    """The provider could not answer. Never includes the key, the prompt or the transcript."""


class RealDataRefused(ProviderError):
    """The real provider was asked to run without LLM_ALLOW_REAL_DATA=true."""


class LlmProvider(Protocol):
    name: str
    model: str
    #: money or quota is spent per call (false for the mock)
    paid: bool

    async def complete(self, system: str, user: str) -> LlmResponse: ...


def approx_tokens(text: str) -> int:
    """Rough token count (about three characters per token for mixed Indic text); only used for caps and logs."""
    return max(1, len(text) // 3)


class MockProvider:
    """Replies with `reply(system, user)`; by default an empty fact list. Tests pass their own script."""

    name = "mock"
    paid = False

    def __init__(
        self, reply: Callable[[str, str], str] | str | None = None, model: str = "mock-model"
    ) -> None:
        self.model = model
        self._reply = reply if reply is not None else json.dumps({"facts": []})

    async def complete(self, system: str, user: str) -> LlmResponse:
        text = self._reply(system, user) if callable(self._reply) else self._reply
        return LlmResponse(text, self.model, approx_tokens(system + user), approx_tokens(text))


def build_provider(env: Mapping[str, str], cache_dir: Path | None = None) -> LlmProvider:
    kind = env.get("LLM_PROVIDER", "mock").strip().lower() or "mock"
    if kind == "mock":
        return MockProvider(model=env.get("LLM_MODEL", "mock-model") or "mock-model")
    if kind == "openai_compatible":
        from app.extraction.openai_compat import (  # noqa: PLC0415 - avoids a circular import
            CachedProvider,
            OpenAICompatibleProvider,
            RequestBudget,
            ResponseCache,
        )

        real = OpenAICompatibleProvider(
            env.get("LLM_BASE_URL", ""),
            env.get("LLM_MODEL", ""),
            env.get("LLM_API_KEY", ""),
            env.get("LLM_ALLOW_REAL_DATA", "false").strip().lower() == "true",
            budget=RequestBudget(int(env.get("LLM_REQUEST_CAP", "60") or 60)),
            concurrency=int(env.get("LLM_CONCURRENCY", "2") or 2),
            max_retries=int(env.get("LLM_MAX_RETRIES", "3") or 3),
            timeout=float(env.get("LLM_TIMEOUT_SECONDS", "120") or 120),
            max_tokens=int(env.get("LLM_MAX_TOKENS", "4096") or 4096),
            response_format=env.get("LLM_RESPONSE_FORMAT", "json_object") or "json_object",
        )
        if cache_dir is None:
            return real
        from app.extraction.pipelines import PROMPT_VERSION  # noqa: PLC0415

        return CachedProvider(real, ResponseCache(cache_dir), PROMPT_VERSION)
    raise ProviderError(f"unknown LLM_PROVIDER '{kind}' (mock, openai_compatible)")
