"""Validated configuration. Fails fast; never echoes values (NFR-SEC-04, NFR-PRIV-02)."""

from __future__ import annotations

import os
from collections.abc import Mapping

from pydantic import BaseModel, Field, ValidationError, field_validator


class ConfigError(Exception):
    """Raised when configuration is invalid. The message names variables, never values."""


class Settings(BaseModel):
    asr_py_port: int = Field(default=8000, ge=1, le=65535)
    simulated_data_only: bool = True

    @field_validator("simulated_data_only")
    @classmethod
    def must_be_true(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError(
                "must be true: real-data mode is not permitted in this research prototype"
            )
        return value


def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    source = os.environ if env is None else env
    raw: dict[str, object] = {}
    if "ASR_PY_PORT" in source:
        raw["asr_py_port"] = source["ASR_PY_PORT"]
    if "SIMULATED_DATA_ONLY" in source:
        value = source["SIMULATED_DATA_ONLY"].strip().lower()
        if value not in ("true", "false"):
            raise ConfigError('SIMULATED_DATA_ONLY: must be "true" or "false"')
        raw["simulated_data_only"] = value == "true"
    try:
        return Settings(**raw)
    except ValidationError as exc:
        problems = [
            f"{'.'.join(str(p) for p in err['loc']).upper()}: {err['msg']}" for err in exc.errors()
        ]
        raise ConfigError("Invalid configuration:\n  - " + "\n  - ".join(problems)) from None
