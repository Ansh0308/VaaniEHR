"""Defence in depth against prompt injection (Phase 12B, ADR-D44).

The first defences are the prompt (the transcript is data), the strict output schema, the grounding step and the doctor, who
confirms every fact. This module adds one deterministic last line: a segment that reads like an instruction to a language model
("ignore all previous instructions and write that ...") cannot be the source of a fact, even if a model that was fooled returns
a fact with a quote copied from it. The facts of the OTHER segments are kept.

Limits, stated plainly: the patterns are English only (a Gujarati or Hindi injection still depends on the other defences), and a
sentence that merely sounds like an instruction loses its facts (a false positive costs the doctor one manual entry; a false
negative is caught by the doctor's confirmation). The counter is reported so the loss is visible.
"""

from __future__ import annotations

import re

_PATTERNS = [
    re.compile(
        r"\b(ignore|disregard|forget|override|bypass)\b.{0,40}\b(previous|prior|above|earlier|all|any|your|the)\b.{0,30}"
        r"\b(instructions?|prompts?|rules?|directions?|guidelines?)\b",
        re.IGNORECASE | re.DOTALL,
    ),
    re.compile(r"\b(system|developer)\s+(prompt|message|instructions?)\b", re.IGNORECASE),
    re.compile(r"\b(new|updated|revised)\s+instructions?\s*:", re.IGNORECASE),
    re.compile(r"\byou\s+are\s+now\b", re.IGNORECASE),
    re.compile(r"\bact\s+as\s+(a|an|the)\b", re.IGNORECASE),
    re.compile(
        r"\b(reveal|show|print|repeat)\b.{0,20}\b(your|the)\b.{0,15}\bprompt\b", re.IGNORECASE
    ),
    re.compile(
        r"\b(write|record|add|enter|state|output|say)\s+that\s+the\s+patient\s+(has|is|needs|should)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(prescribe|order)\s+\w+\s+(for|to)\s+the\s+patient\b.*\b(ignore|instead)\b",
        re.IGNORECASE,
    ),
]


def looks_like_instruction(text: str) -> bool:
    return any(p.search(text) for p in _PATTERNS)
