"""Exact model revisions. Looked up on 2026-10-18 from the Hugging Face metadata API (no weights downloaded).

`trust_remote_code=True` runs Python code that lives in the model repository, so it is allowed ONLY for the exact
commit pinned here and ONLY inside the container (`require_container`). To move to a newer revision, read the new
code first, then change the hash and the date.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PinnedModel:
    repo: str
    revision: str
    #: total size of the repository in megabytes, from the metadata API at pin time (the download command re-checks)
    approx_mb: int
    gated: bool


INDIC_CONFORMER = PinnedModel(
    repo="ai4bharat/indic-conformer-600m-multilingual",
    revision="2a77d305038dfc502fd9464e7d028b90381976cb",
    approx_mb=2557,
    gated=True,
)
WHISPER_MODELS: dict[str, PinnedModel] = {
    "small": PinnedModel(
        "Systran/faster-whisper-small", "536b0662742c02347bc0e980a01041f333bce120", 486, False
    ),
    "medium": PinnedModel(
        "Systran/faster-whisper-medium", "08e178d48790749d25932bbc082711ddcfdfbc4f", 1531, False
    ),
}
ALL_PINNED: dict[str, PinnedModel] = {
    "indicconformer": INDIC_CONFORMER,
    **{f"whisper-{size}": model for size, model in WHISPER_MODELS.items()},
}


class NotInContainer(Exception):
    """The model needs remote code and must not run on the host machine."""


def require_container() -> None:
    """IndicConformer runs remote code (trust_remote_code), so it only loads inside the model container."""
    if os.environ.get("ASR_IN_CONTAINER") == "1" or Path("/.dockerenv").exists():
        return
    raise NotInContainer(
        "IndicConformer runs code from its model repository, so it only runs inside the container "
        "(see docs/ASR.md: docker build -f apps/asr-py/Dockerfile.models ...)"
    )
