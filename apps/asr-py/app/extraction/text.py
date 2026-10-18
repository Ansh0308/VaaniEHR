"""Text normalisation shared with api-node (apps/api-node/src/facts/text.ts, ADR-D29).

A fact's span refers to the NORMALISED segment text: Unicode NFC, runs of whitespace collapsed to one space, trimmed.
Its hash (SHA-256 of that text) is stored with the fact; if the segment changes, the hash no longer matches and the
fact is stale. A test compares this code with vectors computed by the Node implementation.
"""

from __future__ import annotations

import hashlib
import html
import re
import unicodedata

_SPACE = re.compile(r"\s+")


def normalise(text: str) -> str:
    return _SPACE.sub(" ", unicodedata.normalize("NFC", text)).strip()


def text_hash(text: str) -> str:
    return hashlib.sha256(normalise(text).encode("utf-8")).hexdigest()


def escape_for_prompt(text: str) -> str:
    """Makes a segment safe to put between <segment> tags: the transcript cannot close the tag or open a new one."""
    return html.escape(normalise(text), quote=False)


def unescape_from_model(text: str) -> str:
    """The model copies quotes from the ESCAPED text it was shown; undo that before looking them up."""
    return html.unescape(text)
