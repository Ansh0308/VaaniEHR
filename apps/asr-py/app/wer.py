"""Word error rate by plain edit distance (no dependency; jiwer comes with the evaluation phase).

Words are split at spaces after Unicode normalisation and lower-casing; punctuation at a word's edge does not count.
Combining marks (Gujarati vowel signs) stay inside the word.

Two scores (docs/ASR.md):
- STRICT: words must be identical.
- SCRIPT-AWARE: Devanagari letters are first mapped onto the Gujarati block by Unicode offset (U+0900 -> U+0A80),
  so the same word written in the other Indic script counts as a match. Latin is NEVER mapped: a Latin word against an
  Indic word stays an error, and those substitutions are counted separately (`latin_indic_mismatches`).
The result is exact counts, not a verdict: WER = (substitutions + deletions + insertions) / reference words.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass

DEVANAGARI = range(0x0900, 0x0980)
GUJARATI = range(0x0A80, 0x0B00)
OFFSET = 0x0A80 - 0x0900


def words(text: str) -> list[str]:
    """Words are whitespace-separated; punctuation and symbols at their edges are stripped."""
    out = []
    for raw in unicodedata.normalize("NFC", text).lower().split():
        start, end = 0, len(raw)
        while start < end and unicodedata.category(raw[start])[0] in "PSZC":
            start += 1
        while end > start and unicodedata.category(raw[end - 1])[0] in "PSZC":
            end -= 1
        if end > start:
            out.append(raw[start:end])
    return out


def to_gujarati(word: str) -> str:
    """Maps Devanagari letters and signs to the same-offset Gujarati character (only where one is assigned)."""
    out = []
    for ch in word:
        if ord(ch) in DEVANAGARI:
            target = chr(ord(ch) + OFFSET)
            try:
                unicodedata.name(target)
                ch = target
            except ValueError:
                pass
        out.append(ch)
    return "".join(out)


def script_of(ch: str) -> str:
    cp = ord(ch)
    if cp in GUJARATI:
        return "gujarati"
    if cp in DEVANAGARI:
        return "devanagari"
    if ch.isascii() and ch.isalpha():
        return "latin"
    return "other"


def script_share(text: str) -> dict[str, float]:
    """Percent of the letters (and their marks) in each script."""
    counts = {"gujarati": 0, "devanagari": 0, "latin": 0, "other": 0}
    for ch in unicodedata.normalize("NFC", text):
        if ch.isalpha() or unicodedata.category(ch)[0] == "M":
            counts[script_of(ch)] += 1
    total = sum(counts.values()) or 1
    return {k: round(100 * v / total, 1) for k, v in counts.items()}


def _word_script(word: str) -> str:
    scripts = {script_of(c) for c in word if c.isalpha()}
    return (
        "latin"
        if scripts == {"latin"}
        else ("indic" if scripts & {"gujarati", "devanagari"} else "other")
    )


@dataclass(frozen=True)
class WerResult:
    reference_words: int
    substitutions: int
    deletions: int
    insertions: int
    #: substitutions where one word is Latin and the other Indic (only filled by `wer_report`)
    latin_indic_mismatches: int = 0

    @property
    def errors(self) -> int:
        return self.substitutions + self.deletions + self.insertions

    @property
    def wer(self) -> float:
        return (
            self.errors / self.reference_words
            if self.reference_words
            else float(self.insertions > 0)
        )


def align(ref: list[str], hyp: list[str]) -> list[tuple[str, str | None, str | None]]:
    """Edit operations: ('ok'|'sub'|'del'|'ins', reference word, hypothesis word)."""
    n, m = len(ref), len(hyp)
    cost = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        cost[i][0] = i
    for j in range(1, m + 1):
        cost[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost[i][j] = min(
                cost[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]),
                cost[i - 1][j] + 1,
                cost[i][j - 1] + 1,
            )
    ops: list[tuple[str, str | None, str | None]] = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and cost[i][j] == cost[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]):
            ops.append(("ok" if ref[i - 1] == hyp[j - 1] else "sub", ref[i - 1], hyp[j - 1]))
            i, j = i - 1, j - 1
        elif i > 0 and cost[i][j] == cost[i - 1][j] + 1:
            ops.append(("del", ref[i - 1], None))
            i -= 1
        else:
            ops.append(("ins", None, hyp[j - 1]))
            j -= 1
    return ops[::-1]


def _result(ops: list[tuple[str, str | None, str | None]], ref_count: int) -> WerResult:
    mismatches = sum(
        1
        for op, r, h in ops
        if op == "sub" and r and h and {_word_script(r), _word_script(h)} == {"latin", "indic"}
    )
    return WerResult(
        ref_count,
        sum(o[0] == "sub" for o in ops),
        sum(o[0] == "del" for o in ops),
        sum(o[0] == "ins" for o in ops),
        mismatches,
    )


def wer(reference: str, hypothesis: str) -> WerResult:
    """Strict WER."""
    ref, hyp = words(reference), words(hypothesis)
    return _result(align(ref, hyp), len(ref))


def wer_report(reference: str, hypothesis: str) -> tuple[WerResult, WerResult]:
    """(strict, script-aware). The script-aware result also carries the Latin-versus-Indic substitution count."""
    ref, hyp = words(reference), words(hypothesis)
    mapped_ref, mapped_hyp = [to_gujarati(w) for w in ref], [to_gujarati(w) for w in hyp]
    return _result(align(ref, hyp), len(ref)), _result(align(mapped_ref, mapped_hyp), len(ref))
