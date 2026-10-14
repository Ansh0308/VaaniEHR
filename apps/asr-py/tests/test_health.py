from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_success_envelope() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "success": True,
        "data": {"status": "ok", "service": "asr-py", "simulatedDataOnly": True},
    }


def test_unknown_route_is_404() -> None:
    assert client.get("/nope").status_code == 404
