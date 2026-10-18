"""Validated configuration. Fails fast; never echoes values (NFR-SEC-04, NFR-PRIV-02)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, SecretStr, ValidationError, field_validator

REPO_ROOT = Path(__file__).resolve().parents[3]


class ConfigError(Exception):
    """Raised when configuration is invalid. The message names variables, never values."""


class Settings(BaseModel):
    asr_py_port: int = Field(default=8000, ge=1, le=65535)
    simulated_data_only: bool = True
    #: private working folder (git-ignored): encrypted audio and the usage log
    data_dir: Path = REPO_ROOT / "data" / "asr"
    #: paid-engine audio allowed per UTC month, in minutes (owner decision 2026-10-17: default 300)
    monthly_cap_minutes: float = Field(default=300.0, ge=0)
    #: longest manual smoke run, in seconds (owner decision: 300)
    smoke_max_seconds: float = Field(default=300.0, ge=1)
    audio_retention_days: int = Field(default=90, ge=1, le=3650)
    #: browser origins allowed to open the audio WebSocket
    allowed_origins: tuple[str, ...] = ("http://localhost:5173",)
    api_node_url: str = "http://localhost:4000"
    #: engine used when the client does not name one. The safe default is `mock` (made-up text, free); it exists only
    #: when ASR_ENABLE_MOCK=true. A paid engine must be chosen on purpose (ASR_DEFAULT_ENGINE=sarvam).
    default_engine: str = "mock"
    enable_mock: bool = False
    #: false until the owner has settled Sarvam's terms: only verified own-voice files may be sent (app/own_voice.py)
    allow_third_party_audio: bool = False
    #: voice-activity trimming of the stream: silero (needs requirements-vad.txt) or none
    vad: Literal["silero", "none"] = "silero"
    sarvam_api_key: SecretStr | None = None
    #: language model for fact extraction (Phase 5A). `mock` is the default and costs nothing.
    llm_provider: Literal["mock", "openai_compatible"] = "mock"
    llm_model: str = "mock-model"
    llm_base_url: str = ""
    llm_api_key: SecretStr | None = None
    #: the real provider refuses to run unless this is true (free endpoints may log prompts: simulated data only)
    llm_allow_real_data: bool = False
    llm_monthly_cap_inr: float = Field(default=50.0, ge=0)
    llm_monthly_cap_tokens: int = Field(default=200_000, ge=0)
    llm_monthly_cap_requests: int = Field(default=1000, ge=0)
    llm_request_cap: int = Field(default=60, ge=1)
    llm_input_inr_per_million: float = Field(default=0.0, ge=0)
    llm_output_inr_per_million: float = Field(default=0.0, ge=0)
    #: shared with api-node; signs the short-lived consent tokens (>= 32 characters)
    internal_service_secret: SecretStr | None = None
    #: 64 hex characters (32 bytes); encrypts stored audio. Losing it makes stored audio unrecoverable.
    audio_master_key: SecretStr | None = None

    @field_validator("simulated_data_only")
    @classmethod
    def must_be_true(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError(
                "must be true: real-data mode is not permitted in this research prototype"
            )
        return value

    @field_validator("internal_service_secret")
    @classmethod
    def secret_is_long(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None and len(value.get_secret_value()) < 32:
            raise ValueError("must be at least 32 characters")
        return value

    @field_validator("audio_master_key")
    @classmethod
    def key_is_32_bytes_hex(cls, value: SecretStr | None) -> SecretStr | None:
        if value is not None:
            try:
                ok = len(bytes.fromhex(value.get_secret_value())) == 32
            except ValueError:
                ok = False
            if not ok:
                raise ValueError("must be 64 hexadecimal characters")
        return value

    @property
    def usage_log_path(self) -> Path:
        return self.data_dir / "usage.jsonl"

    @property
    def llm_cache_dir(self) -> Path:
        return self.data_dir / "llm-cache"

    @property
    def llm_usage_log_path(self) -> Path:
        return self.data_dir / "llm-usage.jsonl"

    @property
    def audio_dir(self) -> Path:
        return self.data_dir / "audio"


_PLAIN = {
    "ASR_PY_PORT": "asr_py_port",
    "ASR_DATA_DIR": "data_dir",
    "ASR_MONTHLY_CAP_MINUTES": "monthly_cap_minutes",
    "ASR_SMOKE_MAX_SECONDS": "smoke_max_seconds",
    "AUDIO_RETENTION_DAYS": "audio_retention_days",
    "API_NODE_URL": "api_node_url",
    "ASR_VAD": "vad",
    "ASR_DEFAULT_ENGINE": "default_engine",
    "INTERNAL_SERVICE_SECRET": "internal_service_secret",
    "AUDIO_MASTER_KEY": "audio_master_key",
    "SARVAM_API_KEY": "sarvam_api_key",
    "LLM_PROVIDER": "llm_provider",
    "LLM_MODEL": "llm_model",
    "LLM_BASE_URL": "llm_base_url",
    "LLM_API_KEY": "llm_api_key",
    "LLM_MONTHLY_CAP_INR": "llm_monthly_cap_inr",
    "LLM_MONTHLY_CAP_TOKENS": "llm_monthly_cap_tokens",
    "LLM_MONTHLY_CAP_REQUESTS": "llm_monthly_cap_requests",
    "LLM_REQUEST_CAP": "llm_request_cap",
    "LLM_INPUT_INR_PER_MILLION": "llm_input_inr_per_million",
    "LLM_OUTPUT_INR_PER_MILLION": "llm_output_inr_per_million",
}


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env
    raw: dict[str, object] = {}
    for variable, field in _PLAIN.items():
        if source.get(variable, "") != "":
            raw[field] = source[variable]
    if source.get("SARVAM_ALLOW_THIRD_PARTY_AUDIO", "").strip().lower() in ("true", "false"):
        raw["allow_third_party_audio"] = (
            source["SARVAM_ALLOW_THIRD_PARTY_AUDIO"].strip().lower() == "true"
        )
    if source.get("LLM_ALLOW_REAL_DATA", "").strip().lower() in ("true", "false"):
        raw["llm_allow_real_data"] = source["LLM_ALLOW_REAL_DATA"].strip().lower() == "true"
    if source.get("ASR_ENABLE_MOCK", "").strip().lower() in ("true", "false"):
        raw["enable_mock"] = source["ASR_ENABLE_MOCK"].strip().lower() == "true"
    if "SIMULATED_DATA_ONLY" in source:
        value = source["SIMULATED_DATA_ONLY"].strip().lower()
        if value not in ("true", "false"):
            raise ConfigError('SIMULATED_DATA_ONLY: must be "true" or "false"')
        raw["simulated_data_only"] = value == "true"
    if source.get("ALLOWED_ORIGINS", "") != "":
        raw["allowed_origins"] = tuple(
            o.strip().rstrip("/") for o in source["ALLOWED_ORIGINS"].split(",") if o.strip()
        )
    try:
        return Settings(**raw)
    except ValidationError as exc:
        problems = [
            f"{'.'.join(str(p) for p in err['loc']).upper()}: {err['msg']}" for err in exc.errors()
        ]
        raise ConfigError("Invalid configuration:\n  - " + "\n  - ".join(problems)) from None
