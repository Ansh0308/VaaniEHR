"""Starter keyterm list, made by a fixed mechanical rule (not a clinical choice). Always marked UNREVIEWED.

RULE (version 1), applied to the generic names in data/medicines/nlem2022.generics.csv (public NLEM names):
  1. take the FIRST word of every generic name (the text before the first space, "(" or "+");
  2. keep it if it has at least 4 letters and only letters (any case); compare case-insensitively;
  3. count how many distinct generic names start with that word;
  4. sort by that count (most first), ties alphabetically; take the first 50;
  5. write each word once, in the spelling of its first occurrence.
Nothing else: no medical judgement, no removal of words that are not drugs. A clinician must review the list before
it is relied on (docs/OPEN_CLINICAL_ITEMS.md). `python -m app.keyterm_starter [csv] [out]` writes data/asr/keyterms.txt.
"""

from __future__ import annotations

import csv
import re
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

from app.config import REPO_ROOT
from app.keyterms import MAX_TERMS, validate_keyterms

SOURCE = REPO_ROOT / "data" / "medicines" / "nlem2022.generics.csv"
TARGET = REPO_ROOT / "data" / "asr" / "keyterms.txt"
RULE_VERSION = 1


def first_word(name: str) -> str:
    return re.split(r"[\s(+/,]", name.strip(), maxsplit=1)[0]


def starter_terms(generic_names: list[str]) -> list[str]:
    counts: Counter[str] = Counter()
    spelling: dict[str, str] = {}
    for name in generic_names:
        word = first_word(name)
        if len(word) >= 4 and word.isalpha():
            key = word.lower()
            counts[key] += 1
            spelling.setdefault(key, word)
    ranked = sorted(counts, key=lambda k: (-counts[k], k))[:MAX_TERMS]
    return validate_keyterms([spelling[k] for k in ranked])


def write_starter(source: Path = SOURCE, target: Path = TARGET) -> list[str]:
    with source.open(encoding="utf-8", newline="") as handle:
        names = [row["generic_name"] for row in csv.DictReader(handle)]
    terms = starter_terms(names)
    target.parent.mkdir(parents=True, exist_ok=True)
    header = [
        "# status: UNREVIEWED starter list - made by a mechanical rule, not chosen by a clinician",
        f"# rule: version {RULE_VERSION}, see app/keyterm_starter.py (50 most common first words of NLEM generic names)",
        f"# source: {source.name} (private); made {datetime.now(UTC).date().isoformat()}",
        "# edit freely: one term per line, at most 50 terms of 64 characters",
    ]
    target.write_text("\n".join([*header, *terms]) + "\n", encoding="utf-8")
    return terms


if __name__ == "__main__":
    args = [Path(a) for a in sys.argv[1:]]
    written = write_starter(*args)
    print(f"wrote {len(written)} unreviewed keyterms")
