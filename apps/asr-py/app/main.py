"""FastAPI entry point. Phase 1.1: GET /health only (same envelope as api-node)."""

from fastapi import FastAPI

from app.config import load_settings

settings = load_settings()  # fails fast on invalid configuration

app = FastAPI(title="VaaniEHR asr-py", version="0.1.0", docs_url=None, redoc_url=None)


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "success": True,
        "data": {
            "status": "ok",
            "service": "asr-py",
            "simulatedDataOnly": settings.simulated_data_only,
        },
    }
