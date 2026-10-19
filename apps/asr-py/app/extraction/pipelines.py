"""Three extraction pipelines for the ablation (PRD 14.3 experiment 2), all on any LlmProvider (the mock this run):

- plain:       its OWN prompt (extract_plain_v1), no response_format and no schema; the reply is parsed leniently;
                invalid JSON is counted; no grounding.
- constrained: the reply must validate against the STRICT schema (LlmOutput); an invalid reply gives no facts.
- grounded:    constrained + the grounding validator; ungrounded facts are dropped and counted (hallucination metric).
Only `grounded` produces facts that may be stored (they carry a source span). The others are for measurement.

Model input: segment labels (s1, s2, ...) and text ONLY, escaped so a transcript cannot close the <transcript> tag.
No session, patient, clinic or user id, and no name from the database, ever reaches the model.
The transcript is wrapped in delimiters, the model has no tools, and its reply is schema-checked: an instruction hidden
in the speech can at worst become a schema-valid "heard" fact that the doctor must confirm, never an action.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from pydantic import ValidationError

from app.extraction.grounding import find_quote
from app.extraction.models import ExtractedFact, LlmOutput, PredictedFact
from app.extraction.provider import LlmProvider, LlmResponse
from app.extraction.text import escape_for_prompt, normalise, text_hash, unescape_from_model

PROMPT_VERSION = "extract_v1"
PROMPT_FILE = Path(__file__).resolve().parents[2] / "prompts" / f"{PROMPT_VERSION}.md"
PLAIN_PROMPT_VERSION = "extract_plain_v1"
PLAIN_PROMPT_FILE = Path(__file__).resolve().parents[2] / "prompts" / f"{PLAIN_PROMPT_VERSION}.md"
Pipeline = Literal["plain", "constrained", "grounded"]


def system_prompt() -> str:
    return PROMPT_FILE.read_text(encoding="utf-8")


def prompt_hash() -> str:
    return hashlib.sha256(PROMPT_FILE.read_bytes()).hexdigest()


def plain_system_prompt() -> str:
    return PLAIN_PROMPT_FILE.read_text(encoding="utf-8")


def prompt_version_of(pipeline: str) -> str:
    return PLAIN_PROMPT_VERSION if pipeline == "plain" else PROMPT_VERSION


def prompt_hash_of(pipeline: str) -> str:
    path = PLAIN_PROMPT_FILE if pipeline == "plain" else PROMPT_FILE
    return hashlib.sha256(path.read_bytes()).hexdigest()


@dataclass(frozen=True)
class SegmentIn:
    """What asr-py knows about a segment: api-node's id, order, speaker and text."""

    segment_id: str
    seq: int
    speaker: str
    text: str


def label_of(index: int) -> str:
    return f"s{index + 1}"


def build_user_prompt(segments: list[SegmentIn]) -> str:
    """Only labels and text. The labels are local (s1, s2, ...); the real ids stay in this process."""
    lines = [
        f'<segment id="{label_of(i)}">{escape_for_prompt(s.text)}</segment>'
        for i, s in enumerate(segments)
    ]
    return "<transcript>\n" + "\n".join(lines) + "\n</transcript>"


@dataclass
class PipelineResult:
    pipeline: str
    #: grounded facts that may be stored (grounded pipeline only)
    facts: list[ExtractedFact] = field(default_factory=list)
    #: every fact the model gave, for the evaluation (all pipelines)
    predicted: list[PredictedFact] = field(default_factory=list)
    dropped_ungrounded: int = 0
    dropped_invalid: int = 0
    schema_failures: int = 0
    #: plain pipeline: replies from which no JSON object could be read at all
    invalid_json: int = 0
    grounded_exact: int = 0
    grounded_fuzzy: int = 0
    response: LlmResponse | None = None


_FENCE = re.compile(r"^```[a-zA-Z]*\s*|\s*```$")


def _lenient_json(text: str) -> object | None:
    """plain pipeline only: strip code fences, then read the outermost {...} or [...] (a facts object or a list)."""
    cleaned = _FENCE.sub("", text.strip())
    first: object | None = None
    for opener, closer in (("{", "}"), ("[", "]")):
        start, end = cleaned.find(opener), cleaned.rfind(closer)
        if start < 0 or end <= start:
            continue
        try:
            data = json.loads(cleaned[start : end + 1])
        except ValueError:
            continue
        if isinstance(data, list) or (isinstance(data, dict) and "facts" in data):
            return data
        first = first if first is not None else data
    return first


def _predicted(
    fact_type: str,
    value: str,
    negated: bool,
    uncertain: bool,
    label: str | None,
    quote: str,
    **kw: object,
) -> PredictedFact:
    return PredictedFact(
        type=fact_type,
        value=value,
        negated=negated,
        uncertain=uncertain,
        segment_label=label,
        evidence_quote=quote,
        **kw,  # type: ignore[arg-type]
    )


async def run_pipeline(
    pipeline: Pipeline, provider: LlmProvider, segments: list[SegmentIn]
) -> PipelineResult:
    result = PipelineResult(pipeline)
    if pipeline == "plain":
        # the baseline: its own shorter prompt and NO structured-output request to the endpoint
        response = await provider.complete(
            plain_system_prompt(), build_user_prompt(segments), structured=False
        )
    else:
        response = await provider.complete(system_prompt(), build_user_prompt(segments))
    result.response = response

    if pipeline == "plain":
        data = _lenient_json(response.text)
        items = data.get("facts") if isinstance(data, dict) else data
        if not isinstance(items, list):
            result.invalid_json += 1
            result.dropped_invalid += 1
            return result
        for item in items:
            try:
                result.predicted.append(
                    _predicted(
                        str(item["type"]),
                        str(item["value"]),
                        bool(item.get("negated", False)),
                        bool(item.get("uncertain", False)),
                        str(item.get("segment_id")) if item.get("segment_id") else None,
                        str(item["evidence_quote"]),
                    )
                )
            except (KeyError, TypeError):
                result.dropped_invalid += 1
        return result

    try:
        output = LlmOutput.model_validate_json(response.text)
    except ValidationError:
        result.schema_failures += 1  # not repaired, not guessed: the whole reply is refused
        return result

    by_label = {label_of(i): s for i, s in enumerate(segments)}
    for fact in output.facts:
        segment = by_label.get(fact.segment_id)
        base = dict(
            fact_type=fact.type, value=fact.value, negated=fact.negated, uncertain=fact.uncertain,
            label=fact.segment_id, quote=fact.evidence_quote,
        )  # fmt: skip
        if pipeline == "constrained":
            result.predicted.append(_predicted(**base))  # type: ignore[arg-type]
            continue
        match = find_quote(segment.text, fact.evidence_quote) if segment else None
        if segment is None or match is None:
            result.dropped_ungrounded += 1  # the hallucination count
            continue
        if match.match_type == "exact":
            result.grounded_exact += 1
        else:
            result.grounded_fuzzy += 1
        result.predicted.append(_predicted(**base, grounded=True, match_type=match.match_type))  # type: ignore[arg-type]
        result.facts.append(
            ExtractedFact(
                segment_id=segment.segment_id,
                type=fact.type,
                value=fact.value,
                negated=fact.negated,
                uncertain=fact.uncertain,
                speaker=segment.speaker
                if segment.speaker in ("unknown", "doctor", "patient")
                else None,  # type: ignore[arg-type]
                span_start=match.start,
                span_end=match.end,
                # the quote as it is stored: unescaped and normalised, like the text the span refers to
                evidence_quote=normalise(unescape_from_model(fact.evidence_quote)),
                match_type=match.match_type,  # type: ignore[arg-type]
                segment_text_hash=text_hash(segment.text),
            )
        )
    return result
