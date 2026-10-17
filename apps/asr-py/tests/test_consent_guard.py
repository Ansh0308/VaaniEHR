"""Consent guard: tokens signed by api-node are accepted; anything else is refused with a reason code."""

import json
from datetime import UTC, datetime, timedelta

import pytest

from app.consent import ConsentGuard, TokenError, sign, verify_token
from tests.conftest import FIXTURES

SECRET = "x" * 40
SID = "5eed0000-0000-4000-8000-0000000000a1"
T0 = datetime(2026, 10, 17, 12, 0, tzinfo=UTC)


def claims(**over):
    base = {
        "v": 1,
        "aud": "asr-py",
        "sid": SID,
        "scopes": ["ai_processing", "audio"],
        "uid": "u1",
        "cid": "c1",
        "iat": int(T0.timestamp()),
        "exp": int(T0.timestamp()) + 120,
        "jti": "j1",
    }
    return {**base, **over}


def reason(token, **kw):
    with pytest.raises(TokenError) as info:
        verify_token(token, SECRET, now=kw.pop("now", T0), **kw)
    assert not token or token not in str(info.value)
    return info.value.reason


def test_a_token_signed_by_api_node_is_accepted():
    vector = json.loads((FIXTURES / "node_token.json").read_text(encoding="utf-8"))
    got = verify_token(
        vector["token"],
        vector["secret"],
        expected_session=vector["session_id"],
        now=datetime.fromisoformat(vector["now"]) + timedelta(seconds=10),
    )
    assert got.session_id == vector["session_id"] and set(got.scopes) == {"audio", "ai_processing"}


def test_a_good_token_passes_and_a_wrong_secret_does_not():
    assert (
        verify_token(sign(SECRET, claims()), SECRET, now=T0, expected_session=SID).user_id == "u1"
    )
    assert reason(sign("y" * 40, claims())) == "bad_signature"


def test_tampering_is_caught():
    token = sign(SECRET, claims())
    payload, mac = token.split(".")
    forged = sign(SECRET, claims(sid="other")).split(".")[0]
    assert reason(f"{forged}.{mac}") == "bad_signature"
    assert reason(f"{payload}x.{mac}") in {"bad_signature", "malformed"}


@pytest.mark.parametrize("bad", ["", "abc", "a.b.c", ".", "a.", "!!!.???"])
def test_malformed_tokens_are_refused(bad):
    assert reason(bad) in {"malformed", "bad_signature"}


def test_expiry_future_issue_and_lifetime():
    assert reason(sign(SECRET, claims()), now=T0 + timedelta(seconds=121)) == "expired"
    assert (
        reason(sign(SECRET, claims(iat=int(T0.timestamp()) + 600, exp=int(T0.timestamp()) + 700)))
        == "not_yet_valid"
    )
    assert reason(sign(SECRET, claims(exp=int(T0.timestamp()) + 4000))) == "too_long_lived"


def test_wrong_audience_session_or_missing_consent_scope_is_refused():
    assert reason(sign(SECRET, claims(aud="someone-else"))) == "wrong_audience"
    assert reason(sign(SECRET, claims()), expected_session="another-session") == "wrong_session"
    assert reason(sign(SECRET, claims(scopes=["audio"]))) == "missing_consent_scope"
    assert reason(sign(SECRET, claims(scopes=["ai_processing"]))) == "missing_consent_scope"


def test_a_token_works_once():
    guard = ConsentGuard(SECRET)
    token = sign(SECRET, claims())
    guard.admit(token, expected_session=SID, now=T0)
    with pytest.raises(TokenError) as info:
        guard.admit(token, expected_session=SID, now=T0 + timedelta(seconds=5))
    assert info.value.reason == "already_used"
    guard.admit(sign(SECRET, claims(jti="j2")), expected_session=SID, now=T0)
