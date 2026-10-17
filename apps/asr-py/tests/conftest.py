"""Test setup: async tests run on asyncio only, and no test may reach a non-local network host."""

import socket
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(autouse=True)
def no_outside_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """A paid API must never be called from a test (owner rule): block every connect except to this machine."""
    real_connect = socket.socket.connect

    def guarded(self: socket.socket, address: object) -> None:
        host = address[0] if isinstance(address, tuple) else address
        if (
            host not in ("127.0.0.1", "::1", "localhost", "testserver")
            and self.family != socket.AF_UNIX
        ):
            raise AssertionError(f"test tried to open a network connection to {host!r}")
        real_connect(self, address)  # type: ignore[arg-type]

    monkeypatch.setattr(socket.socket, "connect", guarded)
