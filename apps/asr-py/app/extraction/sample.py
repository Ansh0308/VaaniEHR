"""Test-mode "sample extraction" (Phase 5B, ADR-D33). NOT a language model and NOT clinical knowledge.

Used on the consult screen when LLM_PROVIDER is `mock`, so the whole panel can be tried without any model.
Extracts grounded clinical facts using deterministic patterns:
- Duration (days, weeks, months in en/gu/hi)
- Vitals (BP, temperature, pulse)
- Allergies (allergy phrases)
- Red flags (chest pain, shortness of breath)
- Symptoms (fallback to segment words)
- Negation and uncertainty detection across English, Gujarati, and Hindi.

Every fact is verbatim from the segment; the screen labels it "Test mode - sample extraction".
The doctor still confirms or rejects every fact.
"""

from __future__ import annotations

import html
import json
import re

from app.extraction.provider import LlmResponse, approx_tokens

_SEGMENT = re.compile(r'<segment id="(s\d+)">(.*?)</segment>', re.DOTALL)
MAX_SAMPLE_FACTS = 8
WORDS = 3

_NEGATION = re.compile(r"\b(no|not|denies|without|never)\b|નથી|નહિ|ના|નહીં|नहीं|ना", re.IGNORECASE)
_UNCERTAIN = re.compile(r"\b(maybe|perhaps|possibly|suspected|probable|uncertain)\b|કદાચ|શંકા|शायद", re.IGNORECASE)

_VITAL_PATTERNS = [
    re.compile(r"\b(?:\d{2,3}\s*/\s*\d{2,3}(?:\s*mmHg)?)\b"),
    re.compile(r"\b(?:\d{2,3}(?:\.\d)?\s*(?:°?F|°?C|degree|ડિગ્રી))\b", re.IGNORECASE),
    re.compile(r"\b(?:(?:pulse|HR)\s*[:=]?\s*\d{2,3}(?:\s*bpm)?)\b", re.IGNORECASE),
]

_DURATION_PATTERNS = [
    re.compile(r"\b(?:\d+|one|two|three|four|five|six|seven)\s*(?:days?|weeks?|months?|hours?)\b", re.IGNORECASE),
    re.compile(r"(?:\d+|એક|બે|ત્રણ|ચાર|પાંચ)\s*(?:દિવસ|અઠવાડિયા|મહિના)"),
    re.compile(r"(?:\d+|एक|दो|तीन|चार|पांच)\s*(?:दिन|हफ्ते|महीने)"),
]

_ALLERGY_PATTERNS = [
    re.compile(r"\b(?:allerg(?:y|ic)\s+(?:to\s+)?[a-zA-Z]+)\b", re.IGNORECASE),
    re.compile(r"(?:[a-zA-Z\u0A80-\u0AFF\u0900-\u097F]+\s+(?:ની\s+)?એલર્જી)"),
    re.compile(r"(?:[a-zA-Z\u0A80-\u0AFF\u0900-\u097F]+\s+(?:की\s+)?एलर्जी)"),
]

_RED_FLAG_PATTERNS = [
    re.compile(r"\b(?:chest\s+pain|shortness\s+of\s+breath|difficulty\s+breathing)\b", re.IGNORECASE),
    re.compile(r"(?:છાતીમાં\s+દુખાવો|શ્વાસ\s+લેવામાં\s+તકલીફ)"),
    re.compile(r"(?:सीने\s+में\s+दर्द|सांस\s+लेने\s+में\s+दिक्कत)"),
]


class SampleProvider:
    name = "mock"
    model = "sample-extraction"
    paid = False

    async def complete(self, system: str, user: str, *, structured: bool = True) -> LlmResponse:
        facts = []
        for label, raw in _SEGMENT.findall(user):
            clean_text = html.unescape(raw).strip()
            if not clean_text:
                continue

            negated = bool(_NEGATION.search(clean_text))
            uncertain = bool(_UNCERTAIN.search(clean_text))
            found_facts_for_segment = False

            # 1. Red flags
            for pat in _RED_FLAG_PATTERNS:
                m = pat.search(clean_text)
                if m:
                    facts.append({
                        "type": "red_flag_mention",
                        "value": m.group(0),
                        "negated": negated,
                        "uncertain": uncertain,
                        "segment_id": label,
                        "evidence_quote": m.group(0),
                    })
                    found_facts_for_segment = True
                    break

            # 2. Vitals
            for pat in _VITAL_PATTERNS:
                m = pat.search(clean_text)
                if m:
                    facts.append({
                        "type": "vital",
                        "value": m.group(0),
                        "negated": negated,
                        "uncertain": uncertain,
                        "segment_id": label,
                        "evidence_quote": m.group(0),
                    })
                    found_facts_for_segment = True
                    break

            # 3. Allergies
            for pat in _ALLERGY_PATTERNS:
                m = pat.search(clean_text)
                if m:
                    facts.append({
                        "type": "allergy",
                        "value": m.group(0),
                        "negated": negated,
                        "uncertain": uncertain,
                        "segment_id": label,
                        "evidence_quote": m.group(0),
                    })
                    found_facts_for_segment = True
                    break

            # 4. Durations
            for pat in _DURATION_PATTERNS:
                m = pat.search(clean_text)
                if m:
                    facts.append({
                        "type": "duration",
                        "value": m.group(0),
                        "negated": False,
                        "uncertain": uncertain,
                        "segment_id": label,
                        "evidence_quote": m.group(0),
                    })
                    found_facts_for_segment = True
                    break

            # 5. Symptom (if no other clinical fact found, or if negation/uncertainty indicates a clinical finding)
            if not found_facts_for_segment or negated:
                words = clean_text.split()[:WORDS]
                if words:
                    quote = " ".join(words)
                    facts.append({
                        "type": "symptom",
                        "value": quote,
                        "negated": negated,
                        "uncertain": uncertain,
                        "segment_id": label,
                        "evidence_quote": quote,
                    })

            if len(facts) >= MAX_SAMPLE_FACTS:
                break

        text = json.dumps({"facts": facts[:MAX_SAMPLE_FACTS]}, ensure_ascii=False)
        return LlmResponse(text, self.model, approx_tokens(system + user), approx_tokens(text))
