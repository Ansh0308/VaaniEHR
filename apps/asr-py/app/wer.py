"""Word error rate by plain edit distance (no dependency; jiwer comes with the evaluation phase).

Both texts are lower-cased and split into words made of letters/digits (any script), so punctuation does not count.
The result is exact counts, not a verdict: WER = (substitutions + deletions + insertions) / reference words.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_WORD = re.compile(r"[^\W_]+", re.UNICODE)


def words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


@dataclass(frozen=True)
class WerResult:
    reference_words: int
    substitutions: int
    deletions: int
    insertions: int

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


def wer(reference: str, hypothesis: str) -> WerResult:
    ref, hyp = words(reference), words(hypothesis)
    # cost table: (errors, subs, dels, ins)
    previous = [(j, 0, 0, j) for j in range(len(hyp) + 1)]
    for i in range(1, len(ref) + 1):
        row = [(i, 0, i, 0)]
        for j in range(1, len(hyp) + 1):
            sub = previous[j - 1]
            options = [
                (
                    sub[0] + (ref[i - 1] != hyp[j - 1]),
                    sub[1] + (ref[i - 1] != hyp[j - 1]),
                    sub[2],
                    sub[3],
                ),
                (previous[j][0] + 1, previous[j][1], previous[j][2] + 1, previous[j][3]),
                (row[j - 1][0] + 1, row[j - 1][1], row[j - 1][2], row[j - 1][3] + 1),
            ]
            row.append(min(options, key=lambda o: o[0]))
        previous = row
    _, s, d, n = previous[-1]
    return WerResult(len(ref), s, d, n)
