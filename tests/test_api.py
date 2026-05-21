import os

# Garantir que a thread de monitor não seja iniciada durante os testes
os.environ.setdefault("START_MONITOR", "0")

from app import app, status_data, history, lock


def setup_module():
    # popular dados mínimos e previsíveis para os endpoints
    with lock:
        status_data.clear()
        history.clear()
        status_data["Google"] = {
            "name": "Google",
            "url": "https://www.google.com",
            "status": "UP",
            "status_code": 200,
            "latency_ms": 42,
            "checked_at": "2026-05-21T00:00:00Z",
        }
        history["Google"] = [{
            "status": "UP",
            "latency_ms": 42,
            "checked_at": "2026-05-21T00:00:00Z",
        }]


def test_api_status():
    client = app.test_client()
    resp = client.get("/api/status")
    assert resp.status_code == 200
    j = resp.get_json()
    assert "sites" in j
    assert any(s.get("name") == "Google" for s in j["sites"])


def test_api_history():
    client = app.test_client()
    resp = client.get("/api/history/Google")
    assert resp.status_code == 200
    j = resp.get_json()
    assert j["site"] == "Google"
    assert isinstance(j["history"], list)
    assert j["history"][0]["status"] == "UP"
