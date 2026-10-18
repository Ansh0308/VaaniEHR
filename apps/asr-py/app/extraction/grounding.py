"""Grounding validator (FR-F3-03): a fact is kept only if its evidence quote is found inside the segment it cites.

Order: (1) EXACT: after Unicode NFC and whitespace normalisation the quote is a substring of the segment text;
(2) FUZZY: the best window of the segment whose similarity to the quote is at least FUZZY_THRESHOLD (0.85, case-folded,
difflib ratio, only for segments up to MAX_FUZZY_SEGMENT characters). The match type is recorded with the fact. A fact
that matches neither way is DROPPED and counted: that count is the hallucination metric. A fact is never repaired by
guessing: the stored quote is the model's own, and for a fuzzy match the span is the window that was found.
"""

from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher

from app.extraction.text import normalise, unescape_from_model

FUZZY_THRESHOLD = 0.85
MAX_FUZZY_SEGMENT = 600


@dataclass(frozen=True)
class Match:
    start: int
    end: int
    match_type: str  # "exact" | "fuzzy"
    ratio: float


def find_quote(segment_text: str, quote: str) -> Match | None:
    """Where the quote is in the NORMALISED segment text, or None."""
    text = normalise(segment_text)
    wanted = normalise(unescape_from_model(quote))
    if not wanted or not text:
        return None
    at = text.find(wanted)
    if at >= 0:
        return Match(at, at + len(wanted), "exact", 1.0)
    if len(text) > MAX_FUZZY_SEGMENT or len(wanted) < 4:
        return None
    folded_text, folded_quote = text.casefold(), wanted.casefold()
    if len(folded_text) != len(text) or len(folded_quote) != len(wanted):
        return None  # case folding changed the length (rare scripts): positions would not line up, so do not guess
    best: Match | None = None
    low, high = max(3, int(len(wanted) * 0.8)), min(len(text), int(len(wanted) * 1.2) + 1)
    matcher = SequenceMatcher(None, folded_quote, "", autojunk=False)
    for width in range(low, high + 1):
        for start in range(0, len(text) - width + 1):
            matcher.set_seq2(folded_text[start : start + width])
            ratio = matcher.ratio()
            if ratio >= FUZZY_THRESHOLD and (best is None or ratio > best.ratio):
                best = Match(start, start + width, "fuzzy", ratio)
    return best
