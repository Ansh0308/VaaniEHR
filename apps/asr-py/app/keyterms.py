"""The private keyterm list (FR-F2-03): up to 50 drug names that bias the recogniser, 64 characters each (Sarvam limits,
docs/vendor-notes.md). One term per line; lines starting with # are comments. The list lives in data/asr/ (private).
"""

from __future__ import annotations

from pathlib import Path

MAX_TERMS = 50
MAX_CHARS = 64


class KeytermError(Exception):
    """The list breaks a limit. The message names the line, never anything else."""


def validate_keyterms(terms: list[str]) -> list[str]:
    clean = [t.strip() for t in terms]
    if len(clean) > MAX_TERMS:
        raise KeytermError(f"{len(clean)} keyterms; the limit is {MAX_TERMS}")
    seen: set[str] = set()
    for index, term in enumerate(clean, start=1):
        if not term:
            raise KeytermError(f"keyterm {index} is empty")
        if len(term) > MAX_CHARS:
            raise KeytermError(f"keyterm {index} is longer than {MAX_CHARS} characters")
        if term.lower() in seen:
            raise KeytermError(f"keyterm {index} repeats an earlier one")
        seen.add(term.lower())
    return clean


def load_keyterms(path: Path) -> list[str]:
    """Reads the list; a missing file means no keyterms."""
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    return validate_keyterms([ln for ln in lines if ln.strip() and not ln.lstrip().startswith("#")])
