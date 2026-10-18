"""Signed calls from asr-py to api-node's INTERNAL routes (ADR-D26). Standard library only (no extra dependency).

Signature: HMAC-SHA256(secret, "<timestamp>\\n<METHOD>\\n<path>\\n<sha256 hex of the body>") in X-Service-Signature,
with the unix time in X-Service-Timestamp. The same rule is implemented in apps/api-node/src/auth/serviceAuth.ts.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
import urllib.error
import urllib.request
from typing import Any, Protocol

from app.storage import AudioAsset

API_PREFIX = "/api/v1"


class InternalApiError(Exception):
    """api-node could not be reached or refused. The message holds a status code at most, never content."""


def sign_request(secret: str, timestamp: int, method: str, path: str, body: bytes) -> str:
    digest = hashlib.sha256(body).hexdigest()
    message = f"{timestamp}\n{method.upper()}\n{path}\n{digest}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


class InternalApiPort(Protocol):
    """What the rest of the service needs from api-node (tests use a fake of this)."""

    async def register_asset(self, asset: AudioAsset) -> None: ...

    async def mark_deleted(self, asset_id: str, reason: str) -> None: ...

    async def consent_status(self, session_id: str) -> dict[str, Any]: ...

    async def get_segments(self, session_id: str) -> list[dict[str, Any]]: ...

    async def submit_facts(self, session_id: str, body: dict[str, Any]) -> dict[str, Any]: ...


class InternalApi:
    def __init__(self, base_url: str, secret: str, timeout: float = 10.0) -> None:
        self._base = base_url.rstrip("/")
        self._secret = secret
        self._timeout = timeout

    def _call(self, method: str, path: str, body: dict[str, Any] | None) -> dict[str, Any]:
        raw = json.dumps(body).encode() if body is not None else b""
        full = f"{API_PREFIX}{path}"
        timestamp = int(time.time())
        request = urllib.request.Request(  # noqa: S310 - the base URL comes from our own configuration
            f"{self._base}{full}",
            data=raw if body is not None else None,
            method=method,
            headers={
                "X-Service-Timestamp": str(timestamp),
                "X-Service-Signature": sign_request(self._secret, timestamp, method, full, raw),
                **({"Content-Type": "application/json"} if body is not None else {}),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:  # noqa: S310
                payload = json.loads(response.read())
        except urllib.error.HTTPError as exc:
            raise InternalApiError(f"api-node answered {exc.code}") from None
        except (urllib.error.URLError, TimeoutError, ValueError, OSError):
            raise InternalApiError("api-node could not be reached") from None
        return dict(payload.get("data") or {})

    async def register_asset(self, asset: AudioAsset) -> None:
        await asyncio.to_thread(
            self._call,
            "POST",
            "/internal/audio-assets",
            {
                "assetId": asset.id,
                "sessionId": asset.session_id,
                "storageKey": f"{asset.id}.vaud",
                "durationS": asset.duration_s,
                "bytes": asset.bytes,
                "retentionUntil": asset.retention_until,
            },
        )

    async def mark_deleted(self, asset_id: str, reason: str) -> None:
        await asyncio.to_thread(
            self._call, "POST", f"/internal/audio-assets/{asset_id}/deleted", {"reason": reason}
        )

    async def consent_status(self, session_id: str) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._call, "GET", f"/internal/sessions/{session_id}/consent-status", None
        )

    async def get_segments(self, session_id: str) -> list[dict[str, Any]]:
        data = await asyncio.to_thread(
            self._call, "GET", f"/internal/sessions/{session_id}/transcript-segments", None
        )
        return list(data.get("segments", []))

    async def submit_facts(self, session_id: str, body: dict[str, Any]) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._call, "POST", f"/internal/sessions/{session_id}/facts", body
        )
