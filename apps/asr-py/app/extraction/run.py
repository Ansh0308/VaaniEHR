"""Runs one extraction for one session: read the segments (ids and text only) from api-node, ask the model, ground the
facts, submit the grounded ones as "heard", and log the run. `python -m app.extraction.run --session UUID [--pipeline grounded]`.
In Run 1 the provider is the mock (LLM_PROVIDER=mock, the default); nothing here calls a real model."""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import uuid
from typing import Any

from app.config import load_settings
from app.extraction.llm_usage import LlmSpendGuard, LlmUsageLog
from app.extraction.pipelines import (
    PROMPT_VERSION,
    Pipeline,
    PipelineResult,
    SegmentIn,
    build_user_prompt,
    prompt_hash,
    run_pipeline,
    system_prompt,
)
from app.extraction.provider import LlmProvider, approx_tokens, build_provider
from app.internal_api import InternalApi, InternalApiError, InternalApiPort


def log_run(
    usage: LlmUsageLog,
    provider: LlmProvider,
    result: PipelineResult,
    run_id: str,
    purpose: str,
    session_id: str | None,
    requests: int = 0,
) -> None:
    response = result.response
    tokens_in = response.input_tokens if response else 0
    tokens_out = response.output_tokens if response else 0
    usage.add(
        run_id=run_id,
        purpose=purpose,
        pipeline=result.pipeline,
        provider=provider.name,
        model=response.model if response else provider.model,
        prompt_version=PROMPT_VERSION,
        prompt_hash=prompt_hash(),
        input_tokens=tokens_in,
        output_tokens=tokens_out,
        estimated_cost_inr=usage.cost_inr(tokens_in, tokens_out) if provider.paid else 0.0,
        paid=provider.paid,
        facts_kept=len(result.facts) if result.pipeline == "grounded" else len(result.predicted),
        dropped_ungrounded=result.dropped_ungrounded,
        dropped_invalid=result.dropped_invalid,
        schema_failures=result.schema_failures,
        session_id=session_id,
        requests=requests,
    )


async def extract_session(
    api: InternalApiPort,
    session_id: str,
    pipeline: Pipeline,
    provider: LlmProvider,
    usage: LlmUsageLog,
    guard: LlmSpendGuard,
) -> dict[str, Any]:
    raw = await api.get_segments(session_id)  # needs consent on api-node's side too
    segments = [
        SegmentIn(s["segmentId"], int(s["seq"]), str(s.get("speaker", "unknown")), str(s["text"]))
        for s in raw
    ]
    if not segments:
        return {"segments": 0, "inserted": 0}
    guard.check(provider.paid, approx_tokens(system_prompt() + build_user_prompt(segments)))
    before = getattr(provider, "requests_made", 0)
    result = await run_pipeline(pipeline, provider, segments)
    run_id = str(uuid.uuid4())
    log_run(
        usage,
        provider,
        result,
        run_id,
        "extract",
        session_id,
        getattr(provider, "requests_made", 0) - before,
    )
    summary: dict[str, Any] = {
        "segments": len(segments),
        "kept": len(result.facts),
        "dropped_ungrounded": result.dropped_ungrounded,
        "schema_failures": result.schema_failures,
        "inserted": 0,
    }
    if pipeline == "grounded" and result.facts:
        answer = await api.submit_facts(
            session_id,
            {
                "runId": run_id,
                "pipeline": pipeline,
                "model": result.response.model if result.response else provider.model,
                "droppedUngrounded": result.dropped_ungrounded,
                "facts": [
                    {
                        "segmentId": f.segment_id,
                        "type": f.type,
                        "value": f.value,
                        "negated": f.negated,
                        "uncertain": f.uncertain,
                        "speaker": f.speaker,
                        "spanStart": f.span_start,
                        "spanEnd": f.span_end,
                        "evidenceQuote": f.evidence_quote,
                        "matchType": f.match_type,
                        "segmentTextHash": f.segment_text_hash,
                    }
                    for f in result.facts
                ],
            },
        )
        summary.update(
            {
                k: answer.get(k, 0)
                for k in ("inserted", "duplicates", "staleRejected", "invalidRejected")
            }
        )
    return summary


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.extraction.run")
    parser.add_argument("--session", required=True)
    parser.add_argument(
        "--pipeline", default="grounded", choices=["plain", "constrained", "grounded"]
    )
    args = parser.parse_args(argv)
    settings = load_settings()
    if settings.internal_service_secret is None:
        print("INTERNAL_SERVICE_SECRET must be set (npm run setup:env)")
        return 2
    provider = build_provider({**os.environ}, settings.llm_cache_dir)
    usage = LlmUsageLog(
        settings.llm_usage_log_path,
        input_inr_per_million=settings.llm_input_inr_per_million,
        output_inr_per_million=settings.llm_output_inr_per_million,
    )
    guard = LlmSpendGuard(
        usage,
        settings.llm_monthly_cap_inr,
        settings.llm_monthly_cap_tokens,
        settings.llm_monthly_cap_requests,
    )
    api = InternalApi(settings.api_node_url, settings.internal_service_secret.get_secret_value())
    try:
        summary = asyncio.run(
            extract_session(api, args.session, args.pipeline, provider, usage, guard)
        )
    except InternalApiError as exc:
        print(f"api-node refused: {exc}")
        return 1
    print(summary)  # counts only
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
