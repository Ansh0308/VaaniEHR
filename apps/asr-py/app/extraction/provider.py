"""Language-model providers (ADR-D29). The pipeline talks to this interface only.

- MockProvider (the default): canned replies, including bad JSON, wrong types, ungrounded facts and obedience to
  injected instructions, so every defence is tested without a network or a key. Costs nothing.
- OpenAICompatibleProvider: a chat-completions client configured ONLY by LLM_BASE_URL, LLM_MODEL and LLM_API_KEY. It is a
  STUB in Phase 5A Run 1: it checks its settings and the real-data switch and then refuses to call anything.
Provider and model come from environment variables (LLM_PROVIDER, LLM_MODEL). The model never receives patient,
clinic or user data: only segment labels and text (see pipelines.build_user_prompt).
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
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


class NotWired(ProviderError):
    """The real provider is not connected in this phase."""


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


class OpenAICompatibleProvider:
    """Stub for an OpenAI-compatible chat-completions endpoint. NOT wired in Run 1: it never makes a request."""

    name = "openai_compatible"
    paid = True

    def __init__(self, base_url: str, model: str, api_key: str, allow_real_data: bool) -> None:
        if not allow_real_data:
            raise RealDataRefused(
                "LLM_ALLOW_REAL_DATA is false: free or hosted endpoints may log prompts, so this provider will not "
                "run. Set it to true only for simulated test data, or after Sarvam-style no-training terms are confirmed."
            )
        if not (base_url and model and api_key):
            raise ProviderError("LLM_BASE_URL, LLM_MODEL and LLM_API_KEY must all be set")
        self.model = model
        self._base_url = base_url
        self._key = api_key  # held only to be sent as a header later; never logged

    async def complete(self, system: str, user: str) -> LlmResponse:
        raise NotWired("the real LLM provider is not connected in Phase 5A Run 1")


def build_provider(env: Mapping[str, str]) -> LlmProvider:
    kind = env.get("LLM_PROVIDER", "mock").strip().lower() or "mock"
    if kind == "mock":
        return MockProvider(model=env.get("LLM_MODEL", "mock-model") or "mock-model")
    if kind == "openai_compatible":
        return OpenAICompatibleProvider(
            env.get("LLM_BASE_URL", ""),
            env.get("LLM_MODEL", ""),
            env.get("LLM_API_KEY", ""),
            env.get("LLM_ALLOW_REAL_DATA", "false").strip().lower() == "true",
        )
    raise ProviderError(f"unknown LLM_PROVIDER '{kind}' (mock, openai_compatible)")
