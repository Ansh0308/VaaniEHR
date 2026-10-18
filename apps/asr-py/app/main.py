"""FastAPI entry point: GET /health and the audio WebSocket (Phase 4A)."""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.asr.mock import DEMO_SCRIPT, MockEngine
from app.asr.sarvam import SarvamEngine
from app.config import Settings, load_settings
from app.consent import ConsentGuard
from app.internal_api import InternalApi
from app.purge import run_purge
from app.storage import AudioStore
from app.usage import SpendGuard, UsageLog
from app.ws import Services, register

PURGE_EVERY_SECONDS = 3600


def build_services(settings: Settings) -> Services:
    """Real wiring from the environment. Anything not configured stays None and the WebSocket says so."""
    secret = settings.internal_service_secret
    key = settings.audio_master_key
    usage = UsageLog(settings.usage_log_path)
    engines = {}
    if settings.enable_mock:
        engines["mock"] = lambda: MockEngine(DEMO_SCRIPT)
    spend = SpendGuard(usage, settings.monthly_cap_minutes, settings.smoke_max_seconds)
    if settings.sarvam_api_key is not None:
        sarvam_key = settings.sarvam_api_key.get_secret_value()
        # live audio is never verified as the owner's own voice, so it flows only if the owner has allowed it
        engines["sarvam"] = lambda: SarvamEngine(
            sarvam_key, spend=spend, allow_third_party=settings.allow_third_party_audio
        )
    return Services(
        settings=settings,
        guard=ConsentGuard(secret.get_secret_value()) if secret else None,
        api=InternalApi(settings.api_node_url, secret.get_secret_value()) if secret else None,
        store=(
            AudioStore(
                settings.audio_dir,
                bytes.fromhex(key.get_secret_value()),
                settings.audio_retention_days,
            )
            if key
            else None
        ),
        usage=usage,
        spend=SpendGuard(usage, settings.monthly_cap_minutes, settings.smoke_max_seconds),
        engines=engines,
        default_engine=settings.default_engine,
    )


def create_app(services: Services) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        async def purge_loop() -> None:
            while True:
                if services.store is not None and services.api is not None:
                    with contextlib.suppress(Exception):
                        await run_purge(services.store, services.api)
                await asyncio.sleep(PURGE_EVERY_SECONDS)

        task = asyncio.create_task(purge_loop())
        try:
            yield
        finally:
            task.cancel()

    app = FastAPI(
        title="VaaniEHR asr-py", version="0.2.0", docs_url=None, redoc_url=None, lifespan=lifespan
    )

    @app.get("/health")
    def health() -> dict[str, object]:
        return {
            "success": True,
            "data": {
                "status": "ok",
                "service": "asr-py",
                "simulatedDataOnly": services.settings.simulated_data_only,
            },
        }

    register(app, services)
    return app


app = create_app(build_services(load_settings()))  # fails fast on invalid configuration
