"""POST /sessions/{id}/extract: consent token, modes, plain-word errors. No network, no real model."""

import os
import time
from datetime import UTC, datetime

import pytest
from starlette.testclient import TestClient

from app.config import Settings
from app.consent import ConsentGuard, sign
from app.extraction.pipelines import SegmentIn
from app.main import create_app
from app.storage import AudioStore
from app.usage import SpendGuard, UsageLog
from app.ws import Services
from tests.test_extraction import FakeApi as SegApi

SECRET = "s" * 40
SID = "5eed0000-0000-4000-8000-0000000000a1"
ORIGIN = "http://localhost:5173"


def token(**over):
    now = int(time.time())
    claims = {
        "v": 1, "aud": "asr-py", "sid": SID, "scopes": ["audio", "ai_processing"], "uid": "u", "cid": "c",
        "iat": now, "exp": now + 120, "jti": os.urandom(6).hex(),
    }  # fmt: skip
    return sign(SECRET, {**claims, **over})


def make(tmp_path, monkeypatch, provider="mock", allow="false", **cfg):
    monkeypatch.setenv("LLM_PROVIDER", provider)
    monkeypatch.setenv("LLM_ALLOW_REAL_DATA", allow)
    monkeypatch.setenv("LLM_BASE_URL", "http://127.0.0.1:1/v1")
    monkeypatch.setenv("LLM_MODEL", "m")
    monkeypatch.setenv("LLM_API_KEY", "k")
    api = SegApi(
        [
            SegmentIn("seg-1", 0, "patient", "fever since two days"),
            SegmentIn("seg-2", 1, "doctor", "ok"),
        ]
    )
    usage = UsageLog(tmp_path / "usage.jsonl", clock=lambda: datetime.now(UTC))
    services = Services(
        settings=Settings(data_dir=tmp_path, **cfg),
        guard=ConsentGuard(SECRET),
        api=api,
        store=AudioStore(tmp_path / "audio", bytes(range(32))),
        usage=usage,
        spend=SpendGuard(usage, monthly_cap_minutes=300, smoke_max_seconds=300),
        engines={},
    )
    return TestClient(create_app(services)), api


def post(client, tok=None):
    headers = {"Authorization": f"Bearer {tok if tok is not None else token()}", "Origin": ORIGIN}
    return client.post(f"/sessions/{SID}/extract", headers=headers)


def test_mode_endpoint_and_cors(tmp_path, monkeypatch):
    client, _ = make(tmp_path, monkeypatch)
    assert client.get("/extraction/mode").json()["data"] == {
        "mode": "sample",
        "model": "sample-extraction",
    }
    pre = client.options(
        f"/sessions/{SID}/extract",
        headers={
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert pre.headers["access-control-allow-origin"] == ORIGIN
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    assert client.get("/extraction/mode").json()["data"]["mode"] == "blocked"
    monkeypatch.setenv("LLM_ALLOW_REAL_DATA", "true")
    assert client.get("/extraction/mode").json()["data"]["mode"] == "live"


def test_sample_extraction_submits_grounded_facts_and_returns_counts_only(tmp_path, monkeypatch):
    client, api = make(tmp_path, monkeypatch)
    answer = post(client)
    body = answer.json()["data"]
    assert answer.status_code == 200 and body["mode"] == "sample"
    assert body["summary"]["inserted"] == 2 and len(api.submitted) == 1
    assert "fever" not in answer.text  # the answer never carries transcript text
    assert {f["segmentId"] for f in api.submitted[0]["facts"]} == {"seg-1", "seg-2"}


def test_a_token_is_single_use_and_must_carry_both_scopes(tmp_path, monkeypatch):
    client, _ = make(tmp_path, monkeypatch)
    tok = token()
    assert post(client, tok).status_code == 200
    assert post(client, tok).json()["error"]["code"] == "already_used"
    no_ai = post(client, token(scopes=["audio"]))
    assert no_ai.status_code == 403 and no_ai.json()["error"]["code"] == "missing_consent_scope"
    assert post(client, "garbage").status_code == 401
    assert post(client, token(sid="other")).json()["error"]["code"] == "wrong_session"


def test_blocked_real_model_sends_nothing(tmp_path, monkeypatch):
    client, api = make(tmp_path, monkeypatch, provider="openai_compatible", allow="false")
    answer = post(client)
    assert answer.status_code == 403 and answer.json()["error"]["code"] == "real_data_blocked"
    assert api.submitted == []


def test_unreachable_real_model_is_a_plain_error(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_MAX_RETRIES", "0")
    client, _ = make(tmp_path, monkeypatch, provider="openai_compatible", allow="true")
    answer = post(client)
    assert answer.status_code == 502 and answer.json()["error"]["code"] == "model_unavailable"
    assert "Traceback" not in answer.text and "127.0.0.1" not in answer.text


def test_the_monthly_request_cap_is_reported_as_a_limit(tmp_path, monkeypatch):
    client, _ = make(
        tmp_path,
        monkeypatch,
        provider="openai_compatible",
        allow="true",
        llm_monthly_cap_requests=0,
    )
    answer = post(client)
    assert answer.status_code == 429 and answer.json()["error"]["code"] == "cap_reached"


def test_cors_is_an_allowlist_without_credentials(tmp_path, monkeypatch):
    client, _ = make(tmp_path, monkeypatch)
    ask = {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization",
    }
    good = client.options(f"/sessions/{SID}/extract", headers={"Origin": ORIGIN, **ask})
    assert good.headers["access-control-allow-origin"] == ORIGIN
    assert "access-control-allow-credentials" not in good.headers
    for other in ("http://evil.example", "http://localhost:5173.evil.example"):
        bad = client.options(f"/sessions/{SID}/extract", headers={"Origin": other, **ask})
        assert "access-control-allow-origin" not in bad.headers
    simple = client.get("/extraction/mode", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in simple.headers


@pytest.mark.parametrize(
    "bad",
    ["*", "http://*.example.com", "localhost:5173", "http://a.example/path", "ftp://a.example"],
)
def test_a_wildcard_or_malformed_origin_is_refused_by_the_configuration(bad):
    from app.config import ConfigError, load_settings

    with pytest.raises(ConfigError, match="ALLOWED_ORIGINS"):
        load_settings({"ALLOWED_ORIGINS": f"http://localhost:5173,{bad}"})
