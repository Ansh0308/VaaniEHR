"""Consent guard (FR-F1-01): the service refuses audio unless api-node has confirmed consent for the session.

api-node signs a short-lived token (apps/api-node/src/asr/token.ts) only after it has checked that consent scopes
`audio` and `ai_processing` are on record. Here the token is verified: signature (HMAC-SHA256, constant-time),
audience, expiry, session, required scopes, and single use. Failures carry a reason code, never the token text.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime

AUDIENCE = "asr-py"
REQUIRED_SCOPES = ("audio", "ai_processing")
MAX_LIFETIME_SECONDS = 300
CLOCK_SKEW_SECONDS = 30


class TokenError(Exception):
    """The token is not acceptable. `reason` is a short code that is safe to send to the client."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Claims:
    session_id: str
    scopes: tuple[str, ...]
    user_id: str
    clinic_id: str
    issued_at: int
    expires_at: int
    token_id: str


def _b64decode(part: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))
    except ValueError as exc:
        raise TokenError("malformed") from exc


def sign(secret: str, claims: dict[str, object]) -> str:
    """Builds a token the same way api-node does. Used by tests; production tokens come from api-node."""
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    mac = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
    return f"{payload}.{base64.urlsafe_b64encode(mac).rstrip(b'=').decode()}"


def verify_token(
    token: str,
    secret: str,
    *,
    expected_session: str | None = None,
    required_scopes: Iterable[str] = REQUIRED_SCOPES,
    now: datetime | None = None,
) -> Claims:
    parts = token.split(".") if isinstance(token, str) else []
    if len(parts) != 2 or not all(parts):
        raise TokenError("malformed")
    payload, signature = parts
    expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
    if not hmac.compare_digest(expected, _b64decode(signature)):
        raise TokenError("bad_signature")
    try:
        data = json.loads(_b64decode(payload))
        claims = Claims(
            session_id=str(data["sid"]),
            scopes=tuple(str(s) for s in data["scopes"]),
            user_id=str(data["uid"]),
            clinic_id=str(data["cid"]),
            issued_at=int(data["iat"]),
            expires_at=int(data["exp"]),
            token_id=str(data["jti"]),
        )
        version, audience = data["v"], data["aud"]
    except (ValueError, KeyError, TypeError) as exc:
        raise TokenError("malformed") from exc
    if version != 1 or audience != AUDIENCE:
        raise TokenError("wrong_audience")
    moment = int((now or datetime.now(UTC)).timestamp())
    if moment >= claims.expires_at:
        raise TokenError("expired")
    if claims.issued_at > moment + CLOCK_SKEW_SECONDS:
        raise TokenError("not_yet_valid")
    if claims.expires_at - claims.issued_at > MAX_LIFETIME_SECONDS:
        raise TokenError("too_long_lived")
    if expected_session is not None and claims.session_id != expected_session:
        raise TokenError("wrong_session")
    if not set(required_scopes) <= set(claims.scopes):
        raise TokenError("missing_consent_scope")
    return claims


class ConsentGuard:
    """Verifies tokens and refuses a token that was already used (each stream opens with a fresh one)."""

    def __init__(self, secret: str) -> None:
        self._secret = secret
        self._used: dict[str, int] = {}

    def admit(
        self, token: str, *, expected_session: str | None = None, now: datetime | None = None
    ) -> Claims:
        claims = verify_token(token, self._secret, expected_session=expected_session, now=now)
        moment = int((now or datetime.now(UTC)).timestamp())
        self._used = {jti: exp for jti, exp in self._used.items() if exp > moment}
        if claims.token_id in self._used:
            raise TokenError("already_used")
        self._used[claims.token_id] = claims.expires_at
        return claims
