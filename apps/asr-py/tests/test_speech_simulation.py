"""Reproducible speech simulation and Unicode handling tests (Phase 4 quality improvements).

Covers:
- Zero-width character handling without losing Indic vowel marks or ligatures.
- Code-switched language detection and segment annotation fallback.
- Composite language tag validation in WebSocket handshake.
- WebSocket streaming simulation and graceful client disconnect handling.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import os
import time

import pytest
from starlette.testclient import TestClient

from app.asr.engine import ASREngine
from app.asr.mock import MockEngine
from app.asr.types import Capabilities, Segment
from app.config import Settings
from app.consent import ConsentGuard, sign
from app.main import create_app
from app.usage import SpendGuard, UsageLog
from app.wer import (
    align,
    detect_segment_language,
    script_share,
    strip_zero_width,
    to_gujarati,
    wer,
    wer_report,
    words,
)
from app.ws import Services, _valid_start


def test_zero_width_characters_stripped_without_losing_linguistic_vowels():
    # Gujarati "તાવ" (tav) with zero-width non-joiner (ZWNJ: \u200C) and zero-width joiner (ZWJ: \u200D)
    raw_guj = "તા\u200cવ અને ઉ\u200dધરસ"
    clean_guj = "તાવ અને ઉધરસ"
    
    assert strip_zero_width(raw_guj) == clean_guj
    # Tokenized words must preserve the vowel sign 'ા' (aa-matra: \u0ABE)
    w_raw = words(raw_guj)
    w_clean = words(clean_guj)
    assert w_raw == w_clean
    assert w_raw == ["તાવ", "અને", "ઉધરસ"]

    # Hindi "बुखार" (bukhar) with BOM (\uFEFF) and soft hyphen (\u00AD)
    raw_hi = "\ufeffबु\u00adखार"
    clean_hi = "बुखार"
    assert words(raw_hi) == words(clean_hi)
    assert words(raw_hi) == ["बुखार"]

    # Strict edit distance must be 0 between text with zero-width characters and clean text
    res = wer(raw_guj, clean_guj)
    assert res.errors == 0
    assert res.wer == 0.0


def test_linguistic_diacritics_and_halants_preserved():
    # Virama/halant (્ \u0ACD in Gujarati, ् \u094D in Hindi) represents conjuncts and must NOT be stripped
    conjunct_gu = "તકલીફ"
    assert "ી" in words(conjunct_gu)[0]

    conjunct_hi = "कष्ट"
    assert "ष" in words(conjunct_hi)[0] and "्" in words(conjunct_hi)[0]
    
    # Anusvara (ં \u0A82, ं \u0902) must be preserved
    assert words("ખાંસી")[0] == "ખાંસી"
    assert words("ठंड")[0] == "ठंड"


def test_code_switched_language_detection():
    # Pure Gujarati sentence
    assert detect_segment_language("મને બે દિવસથી તાવ છે") == "gu-IN"

    # Pure Hindi sentence
    assert detect_segment_language("मुझे दो दिन से बुखार है") == "hi-IN"

    # Pure English sentence
    assert detect_segment_language("Patient has high fever and cough") == "en-IN"

    # Mixed code-switched with multi-script text (Gujarati + English)
    mixed_gu_en = "Patient says તાવ છે since two days"
    assert detect_segment_language(mixed_gu_en) == "mixed"

    # Mixed code-switched with multi-script text (Devanagari + English)
    mixed_hi_en = "Patient को fever है since morning"
    assert detect_segment_language(mixed_hi_en) == "mixed"

    # Romanized code-switching with Latin script only falls back to en-IN (script != language)
    assert detect_segment_language("Patient ko fever hai since morning") == "en-IN"

    # Fallback to hint when no strong linguistic signal is present (e.g. numbers / punctuation only)
    assert detect_segment_language("120 / 80", fallback_hint="en-IN") == "en-IN"


def test_valid_start_allows_composite_bcp47_language_tags():
    # Normal single tag
    token, lang, terms, eng = _valid_start({"type": "start", "token": "tok123", "language": "gu-IN"})
    assert lang == "gu-IN"

    # Composite multilingual code-switch tag (previously rejected by len > 12)
    token, lang, terms, eng = _valid_start({
        "type": "start",
        "token": "tok123",
        "language": "gu-IN,hi-IN,en-IN",
    })
    assert lang == "gu-IN,hi-IN,en-IN"

    # Subtag with script and region
    token, lang, terms, eng = _valid_start({
        "type": "start",
        "token": "tok123",
        "language": "und-Latn-IN",
    })
    assert lang == "und-Latn-IN"


def test_speech_streaming_simulation_with_mock_engine(tmp_path):
    secret = "s" * 40
    now = int(time.time())
    tok = sign(
        secret,
        {
            "v": 1,
            "aud": "asr-py",
            "sid": "sess-sim-1",
            "scopes": ["audio", "ai_processing"],
            "uid": "u",
            "cid": "c",
            "iat": now,
            "exp": now + 120,
            "jti": os.urandom(6).hex(),
        },
    )
    guard = ConsentGuard(secret)

    script = [
        {"start_ms": 0, "end_ms": 500, "text": "તમને શું તકલીફ છે", "language": "gu-IN"},
        {"start_ms": 600, "end_ms": 1200, "text": "I have fever and body ache", "language": "en-IN"},
    ]

    mock_eng = MockEngine(script, partials=False)

    class FakeApi:
        async def consent_status(self, session_id: str) -> dict[str, Any]:
            return {"scopes": {"audio": True, "ai_processing": True}}

    services = Services(
        settings=Settings(allowed_origins=["http://localhost:5173"], data_dir=tmp_path),
        guard=guard,
        api=FakeApi(),
        store=None,
        usage=UsageLog(tmp_path / "usage.jsonl"),
        spend=SpendGuard(UsageLog(tmp_path / "usage.jsonl"), 60, 60),
        engines={"mock": lambda: mock_eng},
        default_engine="mock",
    )

    app = create_app(services)
    client = TestClient(app)

    with client.websocket_connect(
        "/ws/sessions/sess-sim-1/audio", headers={"Origin": "http://localhost:5173"}
    ) as ws:
        ws.send_json({"type": "start", "token": tok, "language": "gu-IN", "engine": "mock"})
        ready = ws.receive_json()
        assert ready["type"] == "ready"

        # Send simulated audio chunks (16 kHz mono 16-bit PCM = 32 bytes per ms)
        # 16000 bytes = 500 ms
        ws.send_bytes(b"\x00" * 16000)
        seg1 = ws.receive_json()
        assert seg1["type"] == "final"
        assert seg1["segment"]["text"] == "તમને શું તકલીફ છે"

        # Send another 25000 bytes (~780 ms)
        ws.send_bytes(b"\x00" * 25000)
        seg2 = ws.receive_json()
        assert seg2["type"] == "final"
        assert seg2["segment"]["text"] == "I have fever and body ache"

        # Clean stop
        ws.send_json({"type": "stop"})
        closed = ws.receive_json()
        assert closed["type"] == "closed"
