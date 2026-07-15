#!/usr/bin/env python3
"""ÆTHER — tiny leaderboard service (stdlib only, no dependencies).

Stores pilot-mode high scores in a JSON file and serves a top-20 list.
Runs isolated on its own port; it touches nothing else on the host.

  GET  /scores          -> {"top": [...]}            (top 20)
  POST /scores {json}    -> {"top": [...], "rank": N} (submit a run)

Body for POST: {"name": str, "score": int, "dist": int, "seed": str}
Run:  python3 scores.py [port]   (default 8478)
"""
import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DATA = os.environ.get("AETHER_SCORES_FILE", "/opt/aether-scores/scores.json")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("AETHER_SCORES_PORT", "8478"))
LOCK = threading.Lock()
MAX_ROWS = 200      # keep at most this many on disk
TOP_N = 20          # return at most this many


def load():
    try:
        with open(DATA, "r", encoding="utf-8") as f:
            rows = json.load(f)
            return rows if isinstance(rows, list) else []
    except Exception:
        return []


def save(rows):
    tmp = DATA + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rows, f)
    os.replace(tmp, DATA)


def clean_name(s):
    s = re.sub(r"[^A-Za-z0-9 _\-]", "", str(s or ""))[:16].strip()
    return s or "PILOT"


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/scores":
            self._send(200, {"top": load()[:TOP_N]})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/scores":
            self._send(404, {"error": "not found"})
            return
        try:
            n = int(self.headers.get("Content-Length", 0) or 0)
            data = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            self._send(400, {"error": "bad json"})
            return
        name = clean_name(data.get("name"))
        try:
            score = max(0, min(1_000_000, int(data.get("score", 0))))
            dist = max(0, min(50_000_000, int(data.get("dist", 0))))
        except Exception:
            self._send(400, {"error": "bad values"})
            return
        seed = re.sub(r"[^A-Za-z0-9]", "", str(data.get("seed", "")))[:16]
        with LOCK:
            rows = load()
            rows.append({"name": name, "score": score, "dist": dist, "seed": seed})
            rows.sort(key=lambda r: r.get("score", 0), reverse=True)
            rows = rows[:MAX_ROWS]
            save(rows)
            rank = next((i + 1 for i, r in enumerate(rows)
                         if r["name"] == name and r["score"] == score and r["seed"] == seed), None)
        self._send(200, {"top": rows[:TOP_N], "rank": rank})

    def log_message(self, *a):
        pass  # quiet


if __name__ == "__main__":
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    print("ÆTHER leaderboard on :%d  (data: %s)" % (PORT, DATA))
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
