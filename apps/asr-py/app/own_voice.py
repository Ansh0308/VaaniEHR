"""The own-voice rule for paid speech services (owner decision 2026-10-17, docs/ASR.md "Sarvam terms").

Until the owner has settled Sarvam's training and retention terms, audio of ANOTHER person must never be sent to
Sarvam. With SARVAM_ALLOW_THIRD_PARTY_AUDIO=false (the default) only a file that is
  - inside the private folder audio/own/, and
  - listed in audio/own/manifest.json as the owner's own voice, with the SHA-256 of the file as it is now
may be sent. Editing the file after listing it breaks the match, so the listing cannot be reused for other audio.
Manifest: {"files": {"clip01.wav": {"voice": "owner", "sha256": "<hex>"}}}
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from app.config import REPO_ROOT

OWN_DIR = REPO_ROOT / "audio" / "own"


class ThirdPartyAudioRefused(Exception):
    """Audio that is not verified as the owner's own voice was about to go to a paid service."""


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_own_voice(path: Path, own_dir: Path = OWN_DIR) -> None:
    """Raises ThirdPartyAudioRefused with a plain explanation unless the file is listed as the owner's voice."""
    try:
        resolved, root = path.resolve(), own_dir.resolve()
    except OSError as exc:
        raise ThirdPartyAudioRefused(f"cannot read {path.name}") from exc
    if root not in resolved.parents:
        raise ThirdPartyAudioRefused(
            f"{path.name} is not inside audio/own/. Only the owner's own voice may be sent to Sarvam "
            "(set SARVAM_ALLOW_THIRD_PARTY_AUDIO=true only after the Sarvam terms are settled)."
        )
    manifest = own_dir / "manifest.json"
    if not manifest.exists():
        raise ThirdPartyAudioRefused(
            f"audio/own/manifest.json is missing: list {path.name} there as the owner's own voice."
        )
    try:
        files = json.loads(manifest.read_text(encoding="utf-8")).get("files", {})
    except ValueError as exc:
        raise ThirdPartyAudioRefused("audio/own/manifest.json is not valid JSON") from exc
    entry = files.get(path.name)
    if not isinstance(entry, dict) or entry.get("voice") != "owner":
        raise ThirdPartyAudioRefused(
            f'{path.name} is not listed in audio/own/manifest.json with "voice": "owner".'
        )
    if entry.get("sha256") != sha256_of(path):
        raise ThirdPartyAudioRefused(
            f"{path.name} changed after it was listed (SHA-256 does not match); list it again."
        )
