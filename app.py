import os
import time
import threading
import tempfile
import logging
import re
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import requests
import yaml
from requests.adapters import HTTPAdapter
from flask import Flask, jsonify, render_template, request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

app = Flask(__name__)

# ── Flask Configuration ────────────────────────────────────────────────────────────
app.config['TESTING'] = os.getenv('TESTING', '0') == '1'

# ── Rate Limiting Configuration ─────────────────────────────────────────────────────
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"],
    storage_uri="memory://",
    enabled=not app.config['TESTING']  # Disable rate limiting in test mode
)

# ── Logging Configuration ───────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('site-monitor.log', encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)

# ── Sites a monitorar ───────────────────────────────────────────────────────────
DEFAULT_SITES = [
    {"name": "Google",        "url": "https://www.google.com"},
    {"name": "GitHub",        "url": "https://github.com"},
    {"name": "Wikipedia",     "url": "https://www.wikipedia.org"},
    {"name": "Cloudflare",    "url": "https://www.cloudflare.com"},
    {"name": "Stack Overflow","url": "https://stackoverflow.com"},
    {"name": "OpenAI",        "url": "https://www.openai.com"},
    {"name": "Reddit",        "url": "https://www.reddit.com"},
    {"name": "YouTube",       "url": "https://www.youtube.com"},
    {"name": "SEU SITE",      "url": "https://www.SEUSITE.com.br"},
]

SITES_FILE = os.getenv("SITES_FILE", "sites.yaml")


def validate_url(url: str) -> bool:
    """Validate URL format. Returns True if valid, False otherwise."""
    if not url or not isinstance(url, str):
        return False
    try:
        result = urlparse(url)
        return result.scheme in ('http', 'https') and bool(result.netloc)
    except Exception:
        return False


def validate_site_name(name: str) -> bool:
    """Validate site name. Alphanumeric, hyphens, underscores, spaces. 1-100 chars."""
    if not name or not isinstance(name, str):
        return False
    if not re.match(r'^[a-zA-Z0-9\s\-_]+$', name):
        return False
    return 1 <= len(name) <= 100


def load_sites():
    if os.path.exists(SITES_FILE):
        try:
            with open(SITES_FILE, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or []
                logger.info(f"Loaded {len(data)} sites from {SITES_FILE}")
                return data
        except Exception as e:
            logger.error(f"Failed to load sites from {SITES_FILE}: {e}", exc_info=True)
            logger.info("Falling back to DEFAULT_SITES")
            return DEFAULT_SITES.copy()
    logger.info(f"Sites file {SITES_FILE} not found, using DEFAULT_SITES")
    return DEFAULT_SITES.copy()


def save_sites(sites: list):
    """Atomically save sites to YAML file. Logs errors if operation fails."""
    target_dir = os.path.dirname(os.path.abspath(SITES_FILE)) or "."
    tmp_fd, tmp_path = tempfile.mkstemp(prefix="sites", suffix=".yaml", dir=target_dir)
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            yaml.safe_dump(sites, f)
        # On Windows, os.replace() may fail if target exists, so remove it first
        if os.path.exists(SITES_FILE):
            try:
                os.remove(SITES_FILE)
            except OSError:
                pass  # May fail due to file locks, that's ok
        os.replace(tmp_path, SITES_FILE)
        logger.info(f"Saved {len(sites)} sites to {SITES_FILE}")
    except Exception as e:
        logger.error(f"Failed to save sites to {SITES_FILE}: {e}", exc_info=True)
        raise
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception as e:
                logger.warning(f"Failed to cleanup temp file {tmp_path}: {e}")


SITES = load_sites()

CHECK_INTERVAL = int(os.getenv("CHECK_INTERVAL", 30))   # segundos
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", 10)) # segundos
MAX_CHECK_WORKERS = max(1, int(os.getenv("MAX_CHECK_WORKERS", "8")))
HISTORY_LIMIT = max(1, int(os.getenv("HISTORY_LIMIT", "50")))
HTTP_USER_AGENT = "SiteMonitor/1.0"

# ── Estado em memória ───────────────────────────────────────────────────────────
status_data: dict[str, dict] = {}
history:     dict[str, list] = {s["name"]: [] for s in SITES}
lock = threading.Lock()
file_lock = threading.Lock()
http_local = threading.local()


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def build_http_session() -> requests.Session:
    session = requests.Session()
    adapter = HTTPAdapter(
        pool_connections=MAX_CHECK_WORKERS,
        pool_maxsize=MAX_CHECK_WORKERS,
    )
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    session.headers.update({"User-Agent": HTTP_USER_AGENT})
    return session


def get_http_session() -> requests.Session:
    session = getattr(http_local, "session", None)
    if session is None:
        session = build_http_session()
        http_local.session = session
    return session


def trim_history(entries: list) -> None:
    if len(entries) > HISTORY_LIMIT:
        del entries[:-HISTORY_LIMIT]


def append_history_entry(result: dict) -> None:
    hist = history.setdefault(result["name"], [])
    hist.append({
        "status": result["status"],
        "latency_ms": result["latency_ms"],
        "checked_at": result["checked_at"],
    })
    trim_history(hist)


def run_checks(sites: list[dict]) -> list[dict]:
    if not sites:
        return []

    workers = min(len(sites), MAX_CHECK_WORKERS)
    if workers == 1:
        return [check_site(site) for site in sites]

    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="site-check") as executor:
        return list(executor.map(check_site, sites))


def build_site_snapshot(site: dict) -> dict:
    current = status_data.get(site["name"])
    if current:
        return {
            "name": current["name"],
            "url": current["url"],
            "status": current.get("status", "PENDING"),
            "status_code": current.get("status_code"),
            "latency_ms": current.get("latency_ms"),
            "checked_at": current.get("checked_at"),
            "error": current.get("error"),
        }

    return {
        "name": site["name"],
        "url": site["url"],
        "status": "PENDING",
        "status_code": None,
        "latency_ms": None,
        "checked_at": None,
    }

def check_site(site: dict) -> dict:
    name = site["name"]
    url  = site["url"]
    try:
        session = get_http_session()
        start = time.perf_counter()
        with session.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True, stream=True) as response:
            latency = round((time.perf_counter() - start) * 1000)
            status_code = response.status_code
            ok = status_code < 400
        result = {
            "name": name, "url": url,
            "status": "UP" if ok else "DOWN",
            "status_code": status_code,
            "latency_ms": latency,
            "checked_at": utc_now_iso(),
        }
        logger.debug(f"Check site '{name}': {result['status']} ({status_code}) in {latency}ms")
        return result
    except requests.exceptions.Timeout:
        logger.warning(f"Check site '{name}': Timeout after {REQUEST_TIMEOUT}s")
        return {"name": name, "url": url, "status": "DOWN",
                "status_code": None, "latency_ms": None,
                "error": "Timeout", "checked_at": utc_now_iso()}
    except Exception as e:
        logger.error(f"Check site '{name}': {type(e).__name__}: {str(e)[:80]}")
        return {"name": name, "url": url, "status": "DOWN",
                "status_code": None, "latency_ms": None,
                "error": str(e)[:80], "checked_at": utc_now_iso()}

def monitor_loop():
    logger.info("Monitor loop started")
    try:
        while True:
            try:
                with lock:
                    sites_snapshot = [site.copy() for site in SITES]

                results = run_checks(sites_snapshot)
                with lock:
                    for r in results:
                        status_data[r["name"]] = r
                        append_history_entry(r)
            except Exception as e:
                logger.error(f"Monitor loop iteration failed: {e}", exc_info=True)
            time.sleep(CHECK_INTERVAL)
    except Exception as e:
        logger.error(f"Monitor loop crashed: {e}", exc_info=True)


@app.route("/api/sites", methods=["POST"])
@limiter.limit("10/minute")
def api_add_site():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    url = (data.get("url") or "").strip()
    
    if not validate_site_name(name):
        logger.warning(f"Invalid site name: {name}")
        return jsonify({"error": "Invalid name: must be 1-100 alphanumeric characters (spaces, hyphens, underscores allowed)"}), 400
    if not validate_url(url):
        logger.warning(f"Invalid URL: {url}")
        return jsonify({"error": "Invalid URL: must start with http:// or https://"}), 400

    with lock:
        if any(s["name"] == name for s in SITES):
            logger.warning(f"Duplicate site name: {name}")
            return jsonify({"error": "site with this name already exists"}), 409
        SITES.append({"name": name, "url": url})
        history[name] = []
        sites_snapshot = [site.copy() for site in SITES]

    with file_lock:
        try:
            save_sites(sites_snapshot)
        except Exception as e:
            logger.error(f"Failed to persist new site '{name}': {e}")
            with lock:
                SITES.pop()
                history.pop(name, None)
            return jsonify({"error": "Failed to save site to disk"}), 500

    logger.info(f"Added new site: {name} ({url})")

    try:
        r = check_site({"name": name, "url": url})
        with lock:
            status_data[name] = r
            append_history_entry(r)
    except Exception as e:
        logger.error(f"Failed to check new site '{name}': {e}")

    return jsonify({"site": name, "url": url}), 201


@app.route("/api/sites/<site_name>", methods=["PUT"])
@limiter.limit("10/minute")
def api_update_site(site_name):
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    url = (data.get("url") or "").strip()
    
    if not validate_site_name(name):
        logger.warning(f"Invalid site name in update: {name}")
        return jsonify({"error": "Invalid name: must be 1-100 alphanumeric characters (spaces, hyphens, underscores allowed)"}), 400
    if not validate_url(url):
        logger.warning(f"Invalid URL in update: {url}")
        return jsonify({"error": "Invalid URL: must start with http:// or https://"}), 400

    with lock:
        idx = next((i for i, s in enumerate(SITES) if s["name"] == site_name), None)
        if idx is None:
            logger.warning(f"Site not found for update: {site_name}")
            return jsonify({"error": "site not found"}), 404
        if name != site_name and any(s["name"] == name for s in SITES):
            logger.warning(f"Duplicate site name in update: {name}")
            return jsonify({"error": "site with this name already exists"}), 409
        SITES[idx] = {"name": name, "url": url}
        if site_name != name:
            history[name] = history.pop(site_name, [])
            current_status = status_data.pop(site_name, None)
            if current_status is not None:
                current_status["name"] = name
                current_status["url"] = url
                status_data[name] = current_status
        elif site_name in status_data:
            status_data[site_name]["url"] = url
        sites_snapshot = [site.copy() for site in SITES]

    with file_lock:
        try:
            save_sites(sites_snapshot)
        except Exception as e:
            logger.error(f"Failed to persist updated site '{site_name}': {e}")
            return jsonify({"error": "Failed to save site to disk"}), 500

    logger.info(f"Updated site: {site_name} -> {name} ({url})")

    try:
        r = check_site({"name": name, "url": url})
        with lock:
            status_data[name] = r
            append_history_entry(r)
    except Exception as e:
        logger.error(f"Failed to check updated site '{name}': {e}")

    return jsonify({"site": name, "url": url})


@app.route("/api/sites/<site_name>", methods=["DELETE"])
@limiter.limit("10/minute")
def api_delete_site(site_name):
    with lock:
        idx = next((i for i, s in enumerate(SITES) if s["name"] == site_name), None)
        if idx is None:
            logger.warning(f"Site not found for delete: {site_name}")
            return jsonify({"error": "site not found"}), 404
        SITES.pop(idx)
        status_data.pop(site_name, None)
        history.pop(site_name, None)
        sites_snapshot = [site.copy() for site in SITES]

    with file_lock:
        try:
            save_sites(sites_snapshot)
        except Exception as e:
            logger.error(f"Failed to persist deletion of site '{site_name}': {e}")
            return jsonify({"error": "Failed to save changes to disk"}), 500

    logger.info(f"Deleted site: {site_name}")
    return jsonify({"deleted": site_name})

# ── Inicia a thread de background (pode ser desativada com a var de ambiente `START_MONITOR=0`) ──
START_MONITOR = os.getenv("START_MONITOR", "1")
if START_MONITOR != "0":
    t = threading.Thread(target=monitor_loop, daemon=True)
    t.start()

# ── Rotas ──────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html", check_interval=CHECK_INTERVAL)

@app.route("/api/status")
@limiter.limit("100/minute")
def api_status():
    with lock:
        sites = []
        for site in SITES:
            snapshot = build_site_snapshot(site)
            snapshot["history"] = list(history.get(site["name"], []))
            sites.append(snapshot)
        total   = len(SITES)
        up      = sum(1 for s in sites if s.get("status") == "UP")
        down    = sum(1 for s in sites if s.get("status") == "DOWN")
        avg_lat = None
        lats = [s["latency_ms"] for s in sites if s.get("latency_ms") is not None]
        if lats:
            avg_lat = round(sum(lats) / len(lats))
        return jsonify({
            "sites": sites,
            "summary": {"total": total, "up": up, "down": down, "avg_latency_ms": avg_lat},
            "generated_at": utc_now_iso(),
        })

@app.route("/api/history/<site_name>")
@limiter.limit("100/minute")
def api_history(site_name):
    with lock:
        hist = list(history.get(site_name, []))
        return jsonify({"site": site_name, "history": hist})


# ── Security Headers ───────────────────────────────────────────────────────────────
@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
