import os
import time
import threading
import requests
from datetime import datetime
from flask import Flask, jsonify, render_template

app = Flask(__name__)

# ── Sites a monitorar ───────────────────────────────────────────────────────────
SITES = [
    {"name": "Google",        "url": "https://www.google.com"},
    {"name": "GitHub",        "url": "https://github.com"},
    {"name": "Wikipedia",     "url": "https://www.wikipedia.org"},
    {"name": "Cloudflare",    "url": "https://www.cloudflare.com"},
    {"name": "Stack Overflow","url": "https://stackoverflow.com"},
    {"name": "OpenAI",        "url": "https://www.openai.com"},
    {"name": "Reddit",        "url": "https://www.reddit.com"},
    {"name": "YouTube",       "url": "https://www.youtube.com"},
]

CHECK_INTERVAL = int(os.getenv("CHECK_INTERVAL", 30))   # segundos
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", 10)) # segundos

# ── Estado em memória ───────────────────────────────────────────────────────────
status_data: dict[str, dict] = {}
history:     dict[str, list] = {s["name"]: [] for s in SITES}
lock = threading.Lock()

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
                hist = history[r["name"]]
                hist.append({
                    "status": r["status"],
                    "latency_ms": r["latency_ms"],
                    "checked_at": r["checked_at"],
                })
                # manter últimos 50 registros por site
                if len(hist) > 50:
                    history[r["name"]] = hist[-50:]
            time.sleep(CHECK_INTERVAL)

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
        sites = list(status_data.values())
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
