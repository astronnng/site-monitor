import os
import time
import threading
import requests
import tempfile
import yaml
from datetime import datetime
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

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


def load_sites():
    if os.path.exists(SITES_FILE):
        try:
            with open(SITES_FILE, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or []
                return data
        except Exception:
            return DEFAULT_SITES.copy()
    return DEFAULT_SITES.copy()


def save_sites(sites: list):
    # atomic write
    tmp_fd, tmp_path = tempfile.mkstemp(prefix="sites", suffix=".yaml")
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            yaml.safe_dump(sites, f)
        os.replace(tmp_path, SITES_FILE)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


SITES = load_sites()

CHECK_INTERVAL = int(os.getenv("CHECK_INTERVAL", 30))   # segundos
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", 10)) # segundos

# ── Estado em memória ───────────────────────────────────────────────────────────
status_data: dict[str, dict] = {}
history:     dict[str, list] = {s["name"]: [] for s in SITES}
lock = threading.Lock()
file_lock = threading.Lock()


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
        start = time.time()
        r = requests.get(url, timeout=REQUEST_TIMEOUT, allow_redirects=True,
                         headers={"User-Agent": "SiteMonitor/1.0"})
        latency = round((time.time() - start) * 1000)   # ms
        ok = r.status_code < 400
        return {
            "name": name, "url": url,
            "status": "UP" if ok else "DOWN",
            "status_code": r.status_code,
            "latency_ms": latency,
            "checked_at": datetime.utcnow().isoformat() + "Z",
        }
    except requests.exceptions.Timeout:
        return {"name": name, "url": url, "status": "DOWN",
                "status_code": None, "latency_ms": None,
                "error": "Timeout", "checked_at": datetime.utcnow().isoformat() + "Z"}
    except Exception as e:
        return {"name": name, "url": url, "status": "DOWN",
                "status_code": None, "latency_ms": None,
                "error": str(e)[:80], "checked_at": datetime.utcnow().isoformat() + "Z"}

def monitor_loop():
    while True:
        results = []
        for site in SITES:
            r = check_site(site)
            results.append(r)
        with lock:
            for r in results:
                status_data[r["name"]] = r
                hist = history.setdefault(r["name"], [])
                hist.append({
                    "status": r["status"],
                    "latency_ms": r["latency_ms"],
                    "checked_at": r["checked_at"],
                })
                # manter últimos 50 registros por site
                if len(hist) > 50:
                    history[r["name"]] = hist[-50:]
        time.sleep(CHECK_INTERVAL)


@app.route("/api/sites", methods=["POST"])
def api_add_site():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    url = (data.get("url") or "").strip()
    if not name or not url:
        return jsonify({"error": "name and url are required"}), 400

    # basic duplicate check
    with lock:
        if any(s["name"] == name for s in SITES):
            return jsonify({"error": "site with this name already exists"}), 409
        SITES.append({"name": name, "url": url})
        history[name] = []

    # persist
    with file_lock:
        try:
            save_sites(SITES)
        except Exception:
            pass

    # optional immediate check
    try:
        r = check_site({"name": name, "url": url})
        with lock:
            status_data[name] = r
            history[name].append({"status": r["status"], "latency_ms": r["latency_ms"], "checked_at": r["checked_at"]})
    except Exception:
        pass

    return jsonify({"site": name, "url": url}), 201


@app.route("/api/sites/<site_name>", methods=["PUT"])
def api_update_site(site_name):
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    url = (data.get("url") or "").strip()
    if not name or not url:
        return jsonify({"error": "name and url are required"}), 400

    with lock:
        # find index
        idx = next((i for i, s in enumerate(SITES) if s["name"] == site_name), None)
        if idx is None:
            return jsonify({"error": "site not found"}), 404
        # prevent name collision
        if name != site_name and any(s["name"] == name for s in SITES):
            return jsonify({"error": "site with this name already exists"}), 409
        SITES[idx] = {"name": name, "url": url}
        # move in-memory state if name changed
        if site_name != name:
            history[name] = history.pop(site_name, [])
            current_status = status_data.pop(site_name, None)
            if current_status is not None:
                current_status["name"] = name
                current_status["url"] = url
                status_data[name] = current_status
        elif site_name in status_data:
            status_data[site_name]["url"] = url

    with file_lock:
        try:
            save_sites(SITES)
        except Exception:
            pass

    # immediate check keeps the card current after edits
    try:
        r = check_site({"name": name, "url": url})
        with lock:
            status_data[name] = r
            hist = history.setdefault(name, [])
            hist.append({
                "status": r["status"],
                "latency_ms": r["latency_ms"],
                "checked_at": r["checked_at"],
            })
            if len(hist) > 50:
                history[name] = hist[-50:]
    except Exception:
        pass

    return jsonify({"site": name, "url": url})


@app.route("/api/sites/<site_name>", methods=["DELETE"])
def api_delete_site(site_name):
    with lock:
        idx = next((i for i, s in enumerate(SITES) if s["name"] == site_name), None)
        if idx is None:
            return jsonify({"error": "site not found"}), 404
        SITES.pop(idx)
        status_data.pop(site_name, None)
        history.pop(site_name, None)

    with file_lock:
        try:
            save_sites(SITES)
        except Exception:
            pass

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
def api_status():
    with lock:
        sites = [build_site_snapshot(site) for site in SITES]
        total   = len(SITES)
        up      = sum(1 for s in sites if s.get("status") == "UP")
        down    = total - up
        avg_lat = None
        lats = [s["latency_ms"] for s in sites if s.get("latency_ms") is not None]
        if lats:
            avg_lat = round(sum(lats) / len(lats))
        return jsonify({
            "sites": sites,
            "summary": {"total": total, "up": up, "down": down, "avg_latency_ms": avg_lat},
            "generated_at": datetime.utcnow().isoformat() + "Z",
        })

@app.route("/api/history/<site_name>")
def api_history(site_name):
    with lock:
        hist = history.get(site_name, [])
        return jsonify({"site": site_name, "history": hist})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
