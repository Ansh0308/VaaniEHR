"""The doctor-clicked "Extract facts" path (Phase 5B, ADR-D33).

  browser --(short-lived consent token from api-node, the same one the audio stream uses)--> POST /sessions/{id}/extract
  asr-py  --(signed internal calls)--> api-node: read the segments, store the facts.

The token is verified and used up on this call (signature, expiry, session, scopes audio + ai_processing), and api-node
checks consent again on every internal call, so consent is needed at click time. Nothing starts by itself. The answer holds
counts and a mode only, never text. GET /extraction/mode tells the screen which label to show.
Modes: "sample" (LLM_PROVIDER=mock: the test-mode sample extraction), "live" (a real model is configured and allowed),
"blocked" (a real model is configured but LLM_ALLOW_REAL_DATA is not true: nothing is sent anywhere).
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, Header
from fastapi.responses import JSONResponse

from app.consent import TokenError
from app.extraction.llm_usage import LlmSpendGuard, LlmUsageLog
from app.extraction.openai_compat import RequestCapExceeded
from app.extraction.provider import LlmProvider, ProviderError, RealDataRefused, build_provider
from app.extraction.run import extract_session
from app.extraction.sample import SampleProvider
from app.internal_api import InternalApiError
from app.usage import CapExceeded
from app.ws import Services


def current_mode(env: dict[str, str] | os._Environ[str]) -> str:
    kind = (env.get("LLM_PROVIDER", "mock") or "mock").strip().lower()
    if kind == "mock":
        return "sample"
    return (
        "live" if env.get("LLM_ALLOW_REAL_DATA", "false").strip().lower() == "true" else "blocked"
    )


def _fail(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status, content={"success": False, "error": {"code": code, "message": message}}
    )


def register_extraction(app: FastAPI, services: Services) -> None:
    cfg = services.settings

    @app.get("/extraction/mode")
    def mode() -> dict[str, Any]:
        env = os.environ
        m = current_mode(env)
        model = "sample-extraction" if m == "sample" else env.get("LLM_MODEL", "") or None
        return {"success": True, "data": {"mode": m, "model": model}}

    @app.post("/sessions/{session_id}/extract", response_model=None)
    async def extract(
        session_id: str, authorization: str | None = Header(default=None)
    ) -> JSONResponse | dict[str, Any]:
        if services.guard is None or services.api is None:
            return _fail(503, "not_configured", "The fact service is not configured.")
        token = (authorization or "").removeprefix("Bearer ").strip()
        try:
            services.guard.admit(token, expected_session=session_id)
        except TokenError as exc:
            status = 403 if exc.reason == "missing_consent_scope" else 401
            return _fail(status, exc.reason, "Consent is required before facts can be extracted.")
        env = dict(os.environ)
        m = current_mode(env)
        if m == "blocked":
            return _fail(
                403,
                "real_data_blocked",
                "A real language model is configured but not allowed for this data. Nothing was sent.",
            )
        usage = LlmUsageLog(
            cfg.llm_usage_log_path,
            input_inr_per_million=cfg.llm_input_inr_per_million,
            output_inr_per_million=cfg.llm_output_inr_per_million,
        )
        guard = LlmSpendGuard(
            usage,
            cfg.llm_monthly_cap_inr,
            cfg.llm_monthly_cap_tokens,
            cfg.llm_monthly_cap_requests,
        )
        try:
            provider: LlmProvider = (
                SampleProvider() if m == "sample" else build_provider(env, cfg.llm_cache_dir)
            )
            summary = await extract_session(
                services.api, session_id, "grounded", provider, usage, guard
            )
        except RealDataRefused:
            return _fail(
                403, "real_data_blocked", "The language model is not allowed for this data."
            )
        except (CapExceeded, RequestCapExceeded):
            return _fail(
                429, "cap_reached", "The usage limit for the language model has been reached."
            )
        except ProviderError as exc:
            limited = "429" in str(exc)
            return _fail(
                429 if limited else 502,
                "rate_limited" if limited else "model_unavailable",
                "The language model is busy right now. Try again in a minute."
                if limited
                else "The language model could not be reached.",
            )
        except InternalApiError:
            return _fail(
                403, "consent_or_api", "The transcript could not be read. Check the consent."
            )
        return {"success": True, "data": {"mode": m, "model": provider.model, "summary": summary}}
