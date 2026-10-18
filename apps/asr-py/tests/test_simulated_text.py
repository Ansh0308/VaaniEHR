"""The simulated-text gate and the real-model evaluation path (fake local server, no real network)."""

import json

import pytest

from app.eval_extraction import main
from app.simulated_text import NotSimulatedRefused, list_files, verify_simulated_text
from app.simulated_text import main as list_main
from tests.test_openai_compat import KEY, Fake

pytestmark = pytest.mark.anyio


def make_dir(tmp_path):
    own = tmp_path / "own"
    own.mkdir()
    (own / "clip90.txt").write_text("the patient has fever\n", encoding="utf-8")
    gold = tmp_path / "gold"
    gold.mkdir()
    (gold / "clip90.json").write_text(
        json.dumps(
            {
                "facts": [
                    {
                        "type": "symptom",
                        "value": "fever",
                        "negated": False,
                        "uncertain": False,
                        "evidence_quote": "has fever",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    return own, gold


def test_listing_requires_confirmation_and_a_changed_file_breaks_the_listing(tmp_path):
    own, _ = make_dir(tmp_path)
    with pytest.raises(NotSimulatedRefused):
        verify_simulated_text(own / "clip90.txt", own)  # no manifest yet
    list_files(["clip90.txt"], own)
    verify_simulated_text(own / "clip90.txt", own)
    (own / "clip90.txt").write_text("changed\n", encoding="utf-8")
    with pytest.raises(NotSimulatedRefused, match="changed"):
        verify_simulated_text(own / "clip90.txt", own)
    with pytest.raises(NotSimulatedRefused):
        list_files(["missing.txt"], own)
    msgs: list[str] = []
    assert list_main(["list", "clip90.txt"], msgs.append) == 2 and "confirm" in msgs[0]


def env(monkeypatch, tmp_path, url):
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_BASE_URL", url)
    monkeypatch.setenv("LLM_MODEL", "fake-model")
    monkeypatch.setenv("LLM_API_KEY", KEY)
    monkeypatch.setenv("ASR_DATA_DIR", str(tmp_path / "data"))


def args(own, gold, *extra):
    return ["--texts", str(own), "--gold-md", str(own / "none.md"), "--gold-dir", str(gold), *extra]


def test_real_model_is_refused_for_text_not_declared_simulated(monkeypatch, tmp_path):
    own, gold = make_dir(tmp_path)
    fake = Fake([])
    env(monkeypatch, tmp_path, fake.url)
    out: list[str] = []
    try:
        assert main(args(own, gold, "--yes-run"), out.append) == 2
    finally:
        fake.close()
    assert "refused" in out[0] and fake.requests == []


def test_without_yes_run_only_the_plan_is_shown_and_nothing_is_sent(monkeypatch, tmp_path):
    own, gold = make_dir(tmp_path)
    list_files(["clip90.txt"], own)
    fake = Fake([])
    env(monkeypatch, tmp_path, fake.url)
    out: list[str] = []
    try:
        assert main(args(own, gold, "--pipeline", "all"), out.append) == 0
    finally:
        fake.close()
    assert "up to 3 requests" in out[0] and "nothing was sent" in out[1] and fake.requests == []


def test_yes_run_calls_the_fake_model_and_a_second_run_uses_the_cache(monkeypatch, tmp_path):
    own, gold = make_dir(tmp_path)
    list_files(["clip90.txt"], own)
    reply = {
        "model": "fake-model",
        "choices": [
            {
                "message": {
                    "content": json.dumps(
                        {
                            "facts": [
                                {
                                    "type": "symptom",
                                    "value": "fever",
                                    "negated": False,
                                    "uncertain": False,
                                    "segment_id": "s1",
                                    "evidence_quote": "has fever",
                                }
                            ]
                        }
                    )
                }
            }
        ],
        "usage": {"prompt_tokens": 50, "completion_tokens": 20},
    }
    fake = Fake([], reply)
    env(monkeypatch, tmp_path, fake.url)
    out: list[str] = []
    try:
        assert main(args(own, gold, "--pipeline", "grounded", "--yes-run"), out.append) == 0
        first = len(fake.requests)
        assert main(args(own, gold, "--pipeline", "grounded", "--yes-run"), out.append) == 0
    finally:
        fake.close()
    assert first == 1 and len(fake.requests) == 1  # the rerun came from the cache
    assert any("| symptom | 1 | 0 | 0 |" in line for line in "\n".join(out).splitlines())
    log = (tmp_path / "data" / "llm-usage.jsonl").read_text(encoding="utf-8")
    assert KEY not in log and "fever" not in log
