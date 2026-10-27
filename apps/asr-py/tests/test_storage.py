"""Encrypted storage, retention, purge and the signed api-node client (no network, no real keys)."""

import json
import os
from datetime import UTC, datetime, timedelta

import pytest

from app.internal_api import InternalApiError, sign_request
from app.purge import run_purge
from app.storage import AudioStore, AudioStoreError
from tests.conftest import FIXTURES

pytestmark = pytest.mark.anyio
KEY = bytes(range(32))
SID = "5eed0000-0000-4000-8000-0000000000a1"
PCM = os.urandom(32_000 * 3)  # 3 seconds of "audio"


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 17, 12, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def store(tmp_path, clock) -> AudioStore:
    return AudioStore(tmp_path / "audio", KEY, retention_days=90, clock=clock)


def test_round_trip_and_nothing_readable_on_disk(store, tmp_path):
    asset = store.save(SID, PCM)
    assert store.load(asset.id) == PCM
    assert asset.duration_s == pytest.approx(3.0)
    for path in (tmp_path / "audio").iterdir():
        assert PCM[:64] not in path.read_bytes()  # the audio is not in any file in the clear
    manifest = json.loads((tmp_path / "audio" / f"{asset.id}.json").read_text())
    assert set(manifest) == {
        "id", "session_id", "created_at", "retention_until", "duration_s", "bytes",
        "sample_rate", "registered", "deleted_at", "deleted_reason", "deletion_reported",
    }  # fmt: skip


def test_retention_date_is_set_from_the_configured_days(store):
    asset = store.save(SID, PCM)
    assert datetime.fromisoformat(asset.retention_until) == datetime(2027, 1, 15, 12, 0, tzinfo=UTC)


async def test_the_90_day_boundary_young_audio_stays_old_audio_goes_and_the_file_is_really_gone(
    store, clock, tmp_path
):
    asset = store.save(SID, PCM)
    clock.now += timedelta(days=89)
    api = FakeApi()
    assert (await run_purge(store, api)).expired == 0  # 89 days: kept
    assert (tmp_path / "audio" / f"{asset.id}.vaud").exists()
    clock.now += timedelta(days=2)  # 91 days: past the 90-day rule
    result = await run_purge(store, api)
    assert result.expired == 1 and result.reported == 1
    assert not (tmp_path / "audio" / f"{asset.id}.vaud").exists()
    assert api.deleted == [
        (asset.id, "retention")
    ]  # api-node audits this report (tests/retention.db.test.ts)
    with pytest.raises(AudioStoreError):
        store.load(asset.id)


def test_wrong_key_damage_and_a_swapped_session_all_fail(store, tmp_path):
    asset = store.save(SID, PCM)
    with pytest.raises(AudioStoreError):
        AudioStore(tmp_path / "audio", bytes(32)).load(asset.id)
    path = tmp_path / "audio" / f"{asset.id}.vaud"
    original = path.read_bytes()
    path.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
    with pytest.raises(AudioStoreError):
        store.load(asset.id)
    path.write_bytes(original)
    manifest = store.get(asset.id)
    manifest.session_id = "another-session"
    store.update(manifest)
    with pytest.raises(AudioStoreError):
        store.load(asset.id)


def test_a_recording_cannot_be_opened_as_another_asset(store, tmp_path):
    a, b = store.save(SID, PCM), store.save(SID, PCM)
    (tmp_path / "audio" / f"{b.id}.vaud").write_bytes(
        (tmp_path / "audio" / f"{a.id}.vaud").read_bytes()
    )
    with pytest.raises(AudioStoreError):
        store.load(b.id)


def test_too_long_recordings_are_refused(store):
    with pytest.raises(AudioStoreError):
        store.save(SID, bytes(32_000 * 3601))


def test_delete_removes_the_file_and_keeps_a_record(store, tmp_path):
    asset = store.save(SID, PCM)
    store.delete(asset.id, "manual")
    assert not (tmp_path / "audio" / f"{asset.id}.vaud").exists()
    kept = store.get(asset.id)
    assert (kept.deleted_reason, kept.deleted_at is not None) == ("manual", True)
    with pytest.raises(AudioStoreError):
        store.load(asset.id)
    store.delete(asset.id, "retention")  # again: nothing changes
    assert store.get(asset.id).deleted_reason == "manual"


class FakeApi:
    def __init__(self, audio_on: bool = True, down: bool = False) -> None:
        self.audio_on, self.down = audio_on, down
        self.registered: list[str] = []
        self.deleted: list[tuple[str, str]] = []

    def _check(self) -> None:
        if self.down:
            raise InternalApiError("api-node could not be reached")

    async def register_asset(self, asset) -> None:
        self._check()
        self.registered.append(asset.id)

    async def mark_deleted(self, asset_id, reason) -> None:
        self._check()
        self.deleted.append((asset_id, reason))

    async def consent_status(self, session_id) -> dict:
        self._check()
        return {"scopes": {"audio": self.audio_on, "ai_processing": self.audio_on}}


async def test_purge_deletes_only_expired_recordings_and_reports_them(store, clock):
    old, fresh = store.save(SID, PCM), None
    clock.now += timedelta(days=60)
    fresh = store.save(SID, PCM)
    clock.now += timedelta(days=31)  # old is 91 days old, fresh is 31
    api = FakeApi()
    result = await run_purge(store, api)
    assert (result.expired, result.withdrawn, result.registered, result.reported) == (1, 0, 2, 1)
    assert (
        store.get(old.id).deleted_reason == "retention" and store.get(fresh.id).deleted_at is None
    )
    assert api.deleted == [(old.id, "retention")]
    assert (await run_purge(store, api)).expired == 0  # nothing more to do


async def test_withdrawn_consent_deletes_the_recording(store):
    asset = store.save(SID, PCM)
    api = FakeApi(audio_on=False)
    result = await run_purge(store, api)
    assert result.withdrawn == 1 and store.get(asset.id).deleted_reason == "consent_withdrawn"
    assert api.deleted == [(asset.id, "consent_withdrawn")]


async def test_when_api_node_is_down_files_are_still_deleted_and_the_report_is_retried(
    store, clock
):
    asset = store.save(SID, PCM)
    clock.now += timedelta(days=91)
    down = FakeApi(down=True)
    result = await run_purge(store, down)
    assert result.expired == 1 and result.failures  # deleted anyway; the problem is listed
    assert store.get(asset.id).deleted_at is not None
    up = FakeApi()
    again = await run_purge(store, up)
    # it was never registered (api-node was down), so there is nothing to report; no crash, no repeat deletion
    assert again.expired == 0 and not again.failures


async def test_registration_is_retried_and_a_deletion_is_reported_once(store, clock):
    asset = store.save(SID, PCM)
    await run_purge(store, FakeApi(down=True))
    assert store.get(asset.id).registered is False
    api = FakeApi()
    await run_purge(store, api)
    assert api.registered == [asset.id] and store.get(asset.id).registered is True
    clock.now += timedelta(days=91)
    await run_purge(store, api)
    await run_purge(store, api)
    assert api.deleted == [(asset.id, "retention")]


def test_the_signature_matches_the_one_api_node_computes():
    v = json.loads((FIXTURES / "node_signature.json").read_text())
    assert (
        sign_request(v["secret"], v["timestamp"], v["method"], v["path"], v["body"].encode())
        == v["signature"]
    )
