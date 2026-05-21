import os

# Garantir que a thread de monitor não seja iniciada durante os testes
import os
import tempfile

# Garantir que a thread de monitor não seja iniciada durante os testes
os.environ.setdefault("START_MONITOR", "0")

# usar arquivo SITES temporário para não alterar o workspace
tmp = tempfile.NamedTemporaryFile(delete=False)
os.environ["SITES_FILE"] = tmp.name

from app import app, status_data, history, lock, SITES


def setup_module():
    # inicializa estado previsível
    with lock:
        status_data.clear()
        history.clear()
        SITES.clear()
        SITES.append({"name": "TestSite", "url": "https://example.com"})
        history["TestSite"] = [{"status": "UP", "latency_ms": 10, "checked_at": "2026-05-21T00:00:00Z"}]
        status_data["TestSite"] = {"name": "TestSite", "url": "https://example.com", "status": "UP", "status_code": 200, "latency_ms": 10, "checked_at": "2026-05-21T00:00:00Z"}


def test_api_status():
    client = app.test_client()
    resp = client.get("/api/status")
    assert resp.status_code == 200
    j = resp.get_json()
    assert "sites" in j
    assert any(s.get("name") == "TestSite" for s in j["sites"])


def test_api_history():
    client = app.test_client()
    resp = client.get("/api/history/TestSite")
    assert resp.status_code == 200
    j = resp.get_json()
    assert j["site"] == "TestSite"
    assert isinstance(j["history"], list)
    assert j["history"][0]["status"] == "UP"


def test_add_update_delete_site():
    client = app.test_client()

    # add
    r = client.post('/api/sites', json={"name": "NewSite", "url": "https://new.example"})
    assert r.status_code == 201

    # duplicate name -> 409
    r2 = client.post('/api/sites', json={"name": "NewSite", "url": "https://x"})
    assert r2.status_code == 409

    # update
    r3 = client.put('/api/sites/NewSite', json={"name": "NewSiteRenamed", "url": "https://renamed.example"})
    assert r3.status_code == 200

    # delete
    r4 = client.delete('/api/sites/NewSiteRenamed')
    assert r4.status_code == 200
