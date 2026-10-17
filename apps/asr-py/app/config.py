"""Validated configuration. Fails fast; never echoes values (NFR-SEC-04, NFR-PRIV-02)."""

from __future__ import annotations

import os
from collections.abc import Mapping
from pathlib import Path

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
    #: engine used when the client does not name one; `mock` is only registered when enable_mock is true
    default_engine: str = "sarvam"
    enable_mock: bool = False
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
    def audio_dir(self) -> Path:
        return self.data_dir / "audio"


_PLAIN = {
    "ASR_PY_PORT": "asr_py_port",
    "ASR_DATA_DIR": "data_dir",
    "ASR_MONTHLY_CAP_MINUTES": "monthly_cap_minutes",
    "ASR_SMOKE_MAX_SECONDS": "smoke_max_seconds",
    "AUDIO_RETENTION_DAYS": "audio_retention_days",
    "API_NODE_URL": "api_node_url",
    "ASR_DEFAULT_ENGINE": "default_engine",
    "INTERNAL_SERVICE_SECRET": "internal_service_secret",
    "AUDIO_MASTER_KEY": "audio_master_key",
}


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env
    raw: dict[str, object] = {}
    for variable, field in _PLAIN.items():
        if source.get(variable, "") != "":
            raw[field] = source[variable]
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
