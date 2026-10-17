"""Retention job: delete expired recordings and recordings whose consent was withdrawn, and keep api-node informed.

Run once from a scheduler (`python -m app.purge`) or hourly inside the service. It prints counts only. If api-node is
unreachable the file is still deleted (deletion is never delayed by a network problem) and the report is retried on
the next run; the same holds for registering a new recording.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from app.internal_api import InternalApi, InternalApiError, InternalApiPort
from app.storage import AudioAsset, AudioStore


@dataclass
class PurgeResult:
    expired: int = 0
    withdrawn: int = 0
    registered: int = 0
    reported: int = 0
    failures: list[str] = field(default_factory=list)


async def run_purge(store: AudioStore, api: InternalApiPort) -> PurgeResult:
    result = PurgeResult()

    async def attempt(label: str, call: object) -> bool:
        try:
            await call  # type: ignore[misc]
        except InternalApiError as exc:
            result.failures.append(f"{label}: {exc}")
            return False
        return True

    # 1) recordings that api-node has not been told about yet
    for asset in store.assets():
        if not asset.registered and asset.deleted_at is None:
            if await attempt("register", api.register_asset(asset)):
                asset.registered = True
                store.update(asset)
                result.registered += 1

    # 2) retention
    for asset in store.expired():
        store.delete(asset.id, "retention")
        result.expired += 1

    # 3) consent withdrawn: one check per session that still has a live recording
    live: dict[str, list[AudioAsset]] = {}
    for asset in store.assets():
        if asset.deleted_at is None:
            live.setdefault(asset.session_id, []).append(asset)
    for session_id, assets in live.items():
        try:
            status = await api.consent_status(session_id)
        except InternalApiError as exc:
            result.failures.append(f"consent check: {exc}")
            continue
        if not status.get("scopes", {}).get("audio", False):
            for asset in assets:
                store.delete(asset.id, "consent_withdrawn")
                result.withdrawn += 1

    # 4) tell api-node about every deletion it does not know yet
    for asset in store.assets():
        if asset.deleted_at is not None and asset.registered and not asset.deletion_reported:
            reason = asset.deleted_reason or "manual"
            if await attempt("report deletion", api.mark_deleted(asset.id, reason)):
                asset.deletion_reported = True
                store.update(asset)
                result.reported += 1
    return result


def main() -> int:
    from app.config import load_settings  # local import: keeps tests free of environment reads

    settings = load_settings()
    if settings.audio_master_key is None or settings.internal_service_secret is None:
        print("AUDIO_MASTER_KEY and INTERNAL_SERVICE_SECRET must be set (npm run setup:env)")
        return 2
    store = AudioStore(
        settings.audio_dir,
        bytes.fromhex(settings.audio_master_key.get_secret_value()),
        settings.audio_retention_days,
    )
    api = InternalApi(settings.api_node_url, settings.internal_service_secret.get_secret_value())
    result = asyncio.run(run_purge(store, api))
    print(
        f"expired {result.expired}, withdrawn {result.withdrawn}, registered {result.registered}, "
        f"reported {result.reported}, failures {len(result.failures)}"
    )
    return 1 if result.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
