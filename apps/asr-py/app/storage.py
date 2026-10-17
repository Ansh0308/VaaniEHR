"""Encrypted audio storage with a retention date (NFR-SEC-03, NFR-PRIV-01, FR-F1-04).

Each recording is one file `<asset id>.vaud` and one plain manifest `<asset id>.json` (ids, times, sizes: no audio,
no text, no names). File layout:
    "VAUD" | version(1) | nonce(12) | wrapped data key (32 + 16) | nonce(12) | AES-256-GCM ciphertext + tag
A fresh random data key encrypts the audio; the master key (AUDIO_MASTER_KEY) only wraps that data key. The header,
the asset id and the session id are authenticated data, so a file moved to another asset or session fails to open.
If the master key is lost the audio cannot be recovered: that is by design (docs/ASR.md).
"""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.asr.types import BYTES_PER_MS

MAGIC = b"VAUD"
VERSION = 1
HEADER = MAGIC + bytes([VERSION])
NONCE = 12
WRAPPED = 32 + 16
MAX_SECONDS = 3600  # one recording is held in memory while it is encrypted


class AudioStoreError(Exception):
    """The file cannot be written or opened (wrong key, damaged file, wrong session). Never includes content."""


@dataclass
class AudioAsset:
    id: str
    session_id: str
    created_at: str
    retention_until: str
    duration_s: float
    bytes: int
    sample_rate: int
    #: api-node knows about it (POST /internal/audio-assets succeeded)
    registered: bool = False
    deleted_at: str | None = None
    deleted_reason: str | None = None
    #: api-node was told about the deletion
    deletion_reported: bool = False


def _now() -> datetime:
    return datetime.now(UTC)


class AudioStore:
    def __init__(
        self,
        directory: Path,
        master_key: bytes,
        retention_days: int = 90,
        clock: Callable[[], datetime] = _now,
    ) -> None:
        if len(master_key) != 32:
            raise ValueError("the audio master key must be 32 bytes")
        self.directory = directory
        self._master = AESGCM(master_key)
        self._days = retention_days
        self._clock = clock

    # ------------------------------------------------------------------ write / read
    def save(self, session_id: str, pcm: bytes, sample_rate: int = 16_000) -> AudioAsset:
        seconds = len(pcm) / (BYTES_PER_MS * 1000)
        if seconds > MAX_SECONDS:
            raise AudioStoreError("recording is too long to store")
        asset_id = str(uuid.uuid4())
        bound = HEADER + asset_id.encode()
        data_key = AESGCM.generate_key(bit_length=256)
        wrap_nonce, nonce = os.urandom(NONCE), os.urandom(NONCE)
        blob = (
            HEADER
            + wrap_nonce
            + self._master.encrypt(wrap_nonce, data_key, bound)
            + nonce
            + AESGCM(data_key).encrypt(nonce, pcm, bound + session_id.encode())
        )
        self.directory.mkdir(parents=True, exist_ok=True)
        self._write(self._file(asset_id), blob)
        now = self._clock()
        asset = AudioAsset(
            id=asset_id,
            session_id=session_id,
            created_at=now.isoformat(timespec="seconds"),
            retention_until=(now + timedelta(days=self._days)).isoformat(timespec="seconds"),
            duration_s=round(seconds, 3),
            bytes=len(blob),
            sample_rate=sample_rate,
        )
        self.update(asset)
        return asset

    def load(self, asset_id: str) -> bytes:
        asset = self.get(asset_id)
        if asset.deleted_at is not None or not self._file(asset_id).exists():
            raise AudioStoreError("recording has been deleted")
        blob = self._file(asset_id).read_bytes()
        bound = HEADER + asset_id.encode()
        try:
            if blob[: len(HEADER)] != HEADER:
                raise AudioStoreError("not a recording file")
            at = len(HEADER)
            wrap_nonce = blob[at : at + NONCE]
            at += NONCE
            data_key = self._master.decrypt(wrap_nonce, blob[at : at + WRAPPED], bound)
            at += WRAPPED
            nonce = blob[at : at + NONCE]
            return AESGCM(data_key).decrypt(
                nonce, blob[at + NONCE :], bound + asset.session_id.encode()
            )
        except InvalidTag as exc:
            raise AudioStoreError("recording cannot be opened (wrong key or damaged)") from exc

    # ------------------------------------------------------------------ manifests
    def get(self, asset_id: str) -> AudioAsset:
        try:
            return AudioAsset(**json.loads(self._manifest(asset_id).read_text(encoding="utf-8")))
        except (OSError, ValueError, TypeError) as exc:
            raise AudioStoreError("unknown recording") from exc

    def update(self, asset: AudioAsset) -> None:
        self._write(self._manifest(asset.id), json.dumps(asdict(asset), indent=2).encode())

    def assets(self) -> list[AudioAsset]:
        if not self.directory.exists():
            return []
        return [self.get(p.stem) for p in sorted(self.directory.glob("*.json"))]

    # ------------------------------------------------------------------ deletion
    def delete(self, asset_id: str, reason: str) -> AudioAsset:
        """Removes the ciphertext (overwritten first) and keeps the manifest as a record of the deletion."""
        asset = self.get(asset_id)
        path = self._file(asset_id)
        if path.exists():
            size = path.stat().st_size
            with path.open("r+b") as handle:
                handle.write(b"\0" * size)
                handle.flush()
                os.fsync(handle.fileno())
            path.unlink()
        if asset.deleted_at is None:
            asset.deleted_at = self._clock().isoformat(timespec="seconds")
            asset.deleted_reason = reason
            self.update(asset)
        return asset

    def expired(self) -> list[AudioAsset]:
        now = self._clock()
        return [
            a
            for a in self.assets()
            if a.deleted_at is None and datetime.fromisoformat(a.retention_until) <= now
        ]

    # ------------------------------------------------------------------ helpers
    def _file(self, asset_id: str) -> Path:
        return self.directory / f"{asset_id}.vaud"

    def _manifest(self, asset_id: str) -> Path:
        return self.directory / f"{asset_id}.json"

    @staticmethod
    def _write(path: Path, data: bytes) -> None:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
