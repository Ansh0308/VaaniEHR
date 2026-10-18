"""Strict models for extraction (FR-F3-01..03). Unknown fields are refused everywhere: a model that adds fields,
"tool calls" or anything else outside the schema produces an invalid response, which is dropped, never repaired."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# red_flag_mention exists in the database but the model is told NOT to use it until a clinician supplies the list.
FactType = Literal[
    "symptom",
    "duration",
    "severity",
    "vital",
    "allergy",
    "past_condition",
    "current_medicine",
    "red_flag_mention",
]
FACT_TYPES: tuple[str, ...] = (
    "symptom",
    "duration",
    "severity",
    "vital",
    "allergy",
    "past_condition",
    "current_medicine",
    "red_flag_mention",
)
Speaker = Literal["unknown", "doctor", "patient"]


class LlmFact(BaseModel):
    """One fact as the model must write it."""

    model_config = ConfigDict(extra="forbid", strict=True)

    type: FactType
    value: str = Field(min_length=1, max_length=500)
    negated: bool
    uncertain: bool
    segment_id: str = Field(min_length=1, max_length=40)
    evidence_quote: str = Field(min_length=1, max_length=1000)


class LlmOutput(BaseModel):
    """The whole answer of the model: {"facts": [...]} and nothing else."""

    model_config = ConfigDict(extra="forbid", strict=True)

    facts: list[LlmFact] = Field(max_length=200)


class ExtractedFact(BaseModel):
    """A fact that passed grounding: it points at the text it came from."""

    model_config = ConfigDict(extra="forbid")

    segment_id: str  # api-node's segment id (not the model's short label)
    type: FactType
    value: str
    negated: bool
    uncertain: bool
    speaker: Speaker | None
    span_start: int = Field(ge=0)
    span_end: int = Field(ge=1)
    evidence_quote: str
    match_type: Literal["exact", "fuzzy"]
    segment_text_hash: str = Field(pattern=r"^[0-9a-f]{64}$")


class PredictedFact(BaseModel):
    """A fact as the ablation pipelines hand it to the evaluation (grounding fields are filled only when grounded)."""

    model_config = ConfigDict(extra="forbid")

    type: str
    value: str
    negated: bool
    uncertain: bool
    segment_label: str | None
    evidence_quote: str
    grounded: bool = False
    match_type: str | None = None
