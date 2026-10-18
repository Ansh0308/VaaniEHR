"""Test-mode "sample extraction" (Phase 5B, ADR-D33). NOT a language model and NOT clinical knowledge.

Used on the consult screen when LLM_PROVIDER is `mock`, so the whole panel can be tried without any model. For each of
the first segments it returns ONE fact of type `symptom` whose value is the first few words of that segment, copied
verbatim, with the same words as its evidence quote. It never interprets, translates or invents anything; the screen
labels it "Test mode - sample extraction". The doctor still confirms or rejects every fact.
"""

from __future__ import annotations

import html
import json
import re

from app.extraction.provider import LlmResponse, approx_tokens

_SEGMENT = re.compile(r'<segment id="(s\d+)">(.*?)</segment>', re.DOTALL)
MAX_SAMPLE_FACTS = 3
WORDS = 3


class SampleProvider:
    name = "mock"
    model = "sample-extraction"
    paid = False

    async def complete(self, system: str, user: str) -> LlmResponse:
        facts = []
        for label, raw in _SEGMENT.findall(user)[:MAX_SAMPLE_FACTS]:
            words = html.unescape(raw).split()[:WORDS]
            if not words:
                continue
            quote = " ".join(words)
            facts.append(
                {
                    "type": "symptom",
                    "value": quote,
                    "negated": False,
                    "uncertain": False,
                    "segment_id": label,
                    "evidence_quote": quote,
                }
            )
        text = json.dumps({"facts": facts}, ensure_ascii=False)
        return LlmResponse(text, self.model, approx_tokens(system + user), approx_tokens(text))
