import pytest

from app.config import ConfigError, load_settings


def test_defaults_are_safe() -> None:
    settings = load_settings({})
    assert settings.simulated_data_only is True
    assert settings.asr_py_port == 8000


def test_rejects_real_data_mode() -> None:
    with pytest.raises(ConfigError) as info:
        load_settings({"SIMULATED_DATA_ONLY": "false"})
    assert "SIMULATED_DATA_ONLY" in str(info.value)


def test_rejects_bad_port_without_echoing_value() -> None:
    with pytest.raises(ConfigError) as info:
        load_settings({"ASR_PY_PORT": "not-a-number-secret"})
    assert "ASR_PY_PORT" in str(info.value)
    assert "not-a-number-secret" not in str(info.value)


def test_rejects_unparseable_boolean() -> None:
    with pytest.raises(ConfigError):
        load_settings({"SIMULATED_DATA_ONLY": "maybe"})
