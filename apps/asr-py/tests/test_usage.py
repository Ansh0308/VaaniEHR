"""Usage log, cost estimate and spend caps (no network)."""

import json
from datetime import UTC, datetime

import pytest

from app.config import ConfigError, load_settings
from app.usage import CapExceeded, SpendGuard, UsageLog

NOW = datetime(2026, 10, 17, 12, 0, tzinfo=UTC)


def make(tmp_path, when=NOW):
    return UsageLog(tmp_path / "data" / "usage.jsonl", clock=lambda: when)


def add(log, engine="sarvam", seconds=60.0, billed=None, purpose="stream"):
    return log.add(
        request_id="req-1",
        purpose=purpose,
        engine=engine,
        engine_version="saaras:v4",
        audio_seconds=seconds,
        billed_seconds=billed,
        session_id="5eed0000-0000-4000-8000-0000000000a1",
    )


def test_a_line_holds_ids_seconds_and_money_only(tmp_path):
    log = make(tmp_path)
    record = add(log, seconds=90, billed=95)
    line = json.loads(log.path.read_text(encoding="utf-8").strip())
    assert set(line) == {
        "ts", "request_id", "purpose", "session_id", "engine", "engine_version", "audio_seconds",
        "billed_seconds", "estimated_cost_inr", "keyterms_requested", "keyterms_applied",
    }  # fmt: skip
    # 95 s billed at 30 INR/hour
    assert record.estimated_cost_inr == pytest.approx(95 * 30 / 3600, abs=1e-4)


def test_local_engines_cost_nothing_and_do_not_count_toward_the_cap(tmp_path):
    log = make(tmp_path)
    add(log, engine="faster-whisper", seconds=3600)
    assert log.paid_seconds_this_month() == 0
    assert log.records()[0].estimated_cost_inr == 0


def test_diarization_is_priced_higher(tmp_path):
    log = make(tmp_path)
    assert log.cost_inr("sarvam-diarization", 3600) == 45
    assert log.cost_inr("sarvam", 3600) == 30


def test_summary_groups_by_engine_and_month(tmp_path):
    log = make(tmp_path)
    add(log, seconds=120)
    add(log, engine="mock", seconds=30)
    assert log.summary()["sarvam"]["audio_seconds"] == 120
    assert log.summary("2026-09") == {}
    next_month = make(tmp_path, datetime(2026, 11, 1, tzinfo=UTC))
    assert next_month.paid_seconds_this_month() == 0  # a new month starts from zero


def test_monthly_cap_refuses_before_audio_is_sent(tmp_path):
    log = make(tmp_path)
    guard = SpendGuard(log, monthly_cap_minutes=5, smoke_max_seconds=300)
    guard.check("sarvam", 200)  # within 300 s
    add(log, seconds=200)
    with pytest.raises(CapExceeded, match="monthly"):
        guard.check("sarvam", 120)
    guard.check("faster-whisper", 10_000)  # local engines are never capped
    assert guard.remaining_paid_seconds() == 100


def test_smoke_runs_are_capped_per_run(tmp_path):
    guard = SpendGuard(make(tmp_path), monthly_cap_minutes=300, smoke_max_seconds=300)
    guard.check("sarvam", 300, purpose="smoke")
    with pytest.raises(CapExceeded, match="smoke"):
        guard.check("sarvam", 301, purpose="smoke")


def test_defaults_match_the_owner_decision_and_bad_values_are_refused_without_echo():
    s = load_settings({})
    assert (s.monthly_cap_minutes, s.smoke_max_seconds, s.audio_retention_days) == (300, 300, 90)
    with pytest.raises(ConfigError) as info:
        load_settings({"AUDIO_MASTER_KEY": "not-hex-secret-value"})
    assert "AUDIO_MASTER_KEY" in str(info.value) and "not-hex-secret-value" not in str(info.value)
    with pytest.raises(ConfigError):
        load_settings({"INTERNAL_SERVICE_SECRET": "short"})
    assert "x" * 40 not in repr(load_settings({"INTERNAL_SERVICE_SECRET": "x" * 40}))
