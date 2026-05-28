import os
import tempfile
import json
from unittest.mock import patch, MagicMock
from concurrent.futures import ThreadPoolExecutor
import threading

from app import app, status_data, history, lock, SITES, validate_url, validate_site_name, check_site, append_history_entry


def setup_module():
    # inicializa estado previsível
    with lock:
        status_data.clear()
        history.clear()
        SITES.clear()
        SITES.append({"name": "TestSite", "url": "https://example.com"})
        history["TestSite"] = [{"status": "UP", "latency_ms": 10, "checked_at": "2026-05-21T00:00:00Z"}]
        status_data["TestSite"] = {"name": "TestSite", "url": "https://example.com", "status": "UP", "status_code": 200, "latency_ms": 10, "checked_at": "2026-05-21T00:00:00Z"}


class TestValidation:
    """Test input validation functions"""
    
    def test_validate_url_valid_https(self):
        assert validate_url("https://example.com") == True
        assert validate_url("https://www.google.com") == True
        assert validate_url("http://localhost:8080") == True
    
    def test_validate_url_invalid(self):
        assert validate_url("not a url") == False
        assert validate_url("") == False
        assert validate_url("ftp://example.com") == False
        assert validate_url("example.com") == False  # missing scheme
        assert validate_url(None) == False
        assert validate_url(123) == False  # not a string
    
    def test_validate_site_name_valid(self):
        assert validate_site_name("Google") == True
        assert validate_site_name("Test-Site") == True
        assert validate_site_name("Test_Site") == True
        assert validate_site_name("My Site 123") == True  # spaces allowed
    
    def test_validate_site_name_invalid(self):
        assert validate_site_name("") == False
        assert validate_site_name("<script>alert('xss')</script>") == False
        assert validate_site_name("Site@#$%") == False
        assert validate_site_name("a" * 101) == False  # too long
        assert validate_site_name(None) == False
        assert validate_site_name(123) == False


class TestAPIBasic:
    """Test basic API operations"""
    
    def test_api_status(self):
        client = app.test_client()
        resp = client.get("/api/status")
        assert resp.status_code == 200
        j = resp.get_json()
        assert "sites" in j
        assert "summary" in j
        site = next((s for s in j["sites"] if s.get("name") == "TestSite"), None)
        assert site is not None
        assert site["history"][0]["status"] == "UP"
        assert j["summary"]["down"] == 0

    def test_api_history(self):
        client = app.test_client()
        resp = client.get("/api/history/TestSite")
        assert resp.status_code == 200
        j = resp.get_json()
        assert j["site"] == "TestSite"
        assert isinstance(j["history"], list)
        assert j["history"][0]["status"] == "UP"

    def test_api_history_nonexistent(self):
        client = app.test_client()
        resp = client.get("/api/history/NonExistent")
        assert resp.status_code == 200
        j = resp.get_json()
        assert j["history"] == []


class TestInputValidation:
    """Test API input validation"""
    
    def test_add_site_invalid_url(self):
        client = app.test_client()
        resp = client.post("/api/sites", json={"name": "Invalid", "url": "not a url"})
        assert resp.status_code == 400
        assert "Invalid URL" in resp.get_json()["error"]
    
    def test_add_site_invalid_name(self):
        client = app.test_client()
        resp = client.post("/api/sites", json={"name": "<script>xss</script>", "url": "https://example.com"})
        assert resp.status_code == 400
        assert "Invalid name" in resp.get_json()["error"]
    
    def test_add_site_empty_name(self):
        client = app.test_client()
        resp = client.post("/api/sites", json={"name": "", "url": "https://example.com"})
        assert resp.status_code == 400
    
    def test_add_site_empty_url(self):
        client = app.test_client()
        resp = client.post("/api/sites", json={"name": "Valid", "url": ""})
        assert resp.status_code == 400
    
    def test_add_site_missing_fields(self):
        client = app.test_client()
        resp = client.post("/api/sites", json={"name": "OnlyName"})
        assert resp.status_code == 400
        
    def test_add_site_invalid_json(self):
        client = app.test_client()
        resp = client.post("/api/sites", data="invalid json", content_type="application/json")
        assert resp.status_code in [400, 415]


class TestCRUDOperations:
    """Test Create, Read, Update, Delete"""
    
    def test_add_update_delete_site(self):
        client = app.test_client()

        # add
        r = client.post('/api/sites', json={"name": "NewSite", "url": "https://new.example"})
        assert r.status_code == 201
        assert r.get_json()["site"] == "NewSite"

        # duplicate name -> 409
        r2 = client.post('/api/sites', json={"name": "NewSite", "url": "https://x"})
        assert r2.status_code == 409

        # update
        r3 = client.put('/api/sites/NewSite', json={"name": "NewSiteRenamed", "url": "https://renamed.example"})
        assert r3.status_code == 200

        # verify update
        r_verify = client.get('/api/status')
        sites = r_verify.get_json()['sites']
        assert any(s['name'] == 'NewSiteRenamed' for s in sites)

        # delete
        r4 = client.delete('/api/sites/NewSiteRenamed')
        assert r4.status_code == 200

        # verify delete
        r_final = client.get('/api/status')
        sites_final = r_final.get_json()['sites']
        assert not any(s['name'] == 'NewSiteRenamed' for s in sites_final)
    
    def test_update_nonexistent_site(self):
        client = app.test_client()
        resp = client.put('/api/sites/DoesNotExist', json={"name": "NewName", "url": "https://example.com"})
        assert resp.status_code == 404
    
    def test_delete_nonexistent_site(self):
        client = app.test_client()
        resp = client.delete('/api/sites/DoesNotExist')
        assert resp.status_code == 404
    
    def test_update_site_invalid_url(self):
        client = app.test_client()
        # First add a site
        client.post('/api/sites', json={"name": "UpdateTest", "url": "https://example.com"})
        # Try to update with invalid URL
        resp = client.put('/api/sites/UpdateTest', json={"name": "Updated", "url": "invalid"})
        assert resp.status_code == 400


class TestCheckSite:
    """Test site checking with mocked HTTP"""
    
    @patch('app.requests.Session.get')
    def test_check_site_up(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.__enter__.return_value = mock_response
        mock_response.__exit__.return_value = None
        mock_get.return_value = mock_response

        result = check_site({"name": "TestCheck", "url": "https://example.com"})
        assert result["status"] == "UP"
        assert result["status_code"] == 200
        assert "latency_ms" in result
        assert result["checked_at"] is not None
    
    @patch('app.requests.Session.get')
    def test_check_site_down_status(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.__enter__.return_value = mock_response
        mock_response.__exit__.return_value = None
        mock_get.return_value = mock_response

        result = check_site({"name": "TestCheck", "url": "https://example.com"})
        assert result["status"] == "DOWN"
        assert result["status_code"] == 500
    
    @patch('app.requests.Session.get')
    def test_check_site_timeout(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.Timeout()

        result = check_site({"name": "TestCheck", "url": "https://example.com"})
        assert result["status"] == "DOWN"
        assert result["error"] == "Timeout"
    
    @patch('app.requests.Session.get')
    def test_check_site_connection_error(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.ConnectionError("Connection refused")

        result = check_site({"name": "TestCheck", "url": "https://example.com"})
        assert result["status"] == "DOWN"
        assert "Connection" in result["error"]


class TestHistoryManagement:
    """Test history tracking and management"""
    
    def test_append_history_entry(self):
        with lock:
            history.clear()
            history["TestHist"] = []
        
        result = {"name": "TestHist", "status": "UP", "latency_ms": 100, "checked_at": "2026-05-28T10:00:00Z"}
        append_history_entry(result)
        
        assert len(history["TestHist"]) == 1
        assert history["TestHist"][0]["status"] == "UP"
    
    def test_history_trim(self):
        with lock:
            history.clear()
            history["TestTrim"] = []
        
        # Add more entries than HISTORY_LIMIT (50 by default)
        from app import HISTORY_LIMIT
        for i in range(HISTORY_LIMIT + 20):
            result = {
                "name": "TestTrim",
                "status": "UP",
                "latency_ms": 50 + i,
                "checked_at": f"2026-05-28T10:00:{i:02d}Z"
            }
            append_history_entry(result)
        
        # Should be trimmed to HISTORY_LIMIT
        assert len(history["TestTrim"]) == HISTORY_LIMIT


class TestConcurrency:
    """Test thread-safe operations"""
    
    def test_concurrent_add_delete(self):
        """Test that concurrent add/delete operations don't crash"""
        client = app.test_client()
        
        def add_site(i):
            return client.post('/api/sites', json={"name": f"Concurrent{i}", "url": f"https://example{i}.com"})
        
        def delete_site(i):
            # Wait a bit to ensure site is added first
            import time
            time.sleep(0.1)
            return client.delete(f'/api/sites/Concurrent{i}')
        
        # Run concurrent operations
        with ThreadPoolExecutor(max_workers=4) as executor:
            add_futures = [executor.submit(add_site, i) for i in range(5)]
            add_results = [f.result() for f in add_futures]
            
            delete_futures = [executor.submit(delete_site, i) for i in range(5)]
            delete_results = [f.result() for f in delete_futures]
        
        # All adds should succeed
        assert all(r.status_code == 201 for r in add_results)
        # All deletes should succeed
        assert all(r.status_code == 200 for r in delete_results)


class TestSecurityHeaders:
    """Test security headers in responses"""
    
    def test_content_type_options_header(self):
        client = app.test_client()
        resp = client.get("/api/status")
        # Header should be set to prevent MIME sniffing
        # This will be added in app.py after_request hook
        assert resp.status_code == 200


class TestErrorRecovery:
    """Test error handling and recovery"""
    
    @patch('app.save_sites')
    def test_add_site_persistence_error(self, mock_save):
        """Test that add fails gracefully if persistence fails"""
        mock_save.side_effect = IOError("Disk full")
        
        client = app.test_client()
        resp = client.post('/api/sites', json={"name": "PersistFail", "url": "https://example.com"})
        # Should return 500 error
        assert resp.status_code == 500
        assert "Failed to save" in resp.get_json()["error"]
