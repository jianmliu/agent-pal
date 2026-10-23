#!/usr/bin/env python3
"""Persistent HTTP server for Convai Laya (System-1 Calibrated Decision Model)."""
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

os.environ["USE_TF"] = "0"
import laya

MODEL_ID = os.environ.get("LAYA_MODEL", "convaiinnovations/laya-multilingual")
PORT = int(os.environ.get("LAYA_PORT", "18765"))

print(f"[laya-daemon] Loading {MODEL_ID}...", flush=True)
t0 = time.time()
AGENT = laya.load(MODEL_ID)
# Expand context window for mmBERT-base (supports up to 8192 tokens)
AGENT.cfg["max_len"] = int(os.environ.get("LAYA_MAX_LEN", "2048"))
AGENT.cfg["head_max_len"] = int(os.environ.get("LAYA_HEAD_MAX_LEN", "768"))
# Warm up MPS/CPU kernels
AGENT.predict({"warmup": "ok"}, {"q": {"type": "noul", "instructions": "is warmup ok?"}})
print(f"[laya-daemon] Ready on http://127.0.0.1:{PORT} in {time.time() - t0:.2f}s (device={AGENT.device})", flush=True)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "model": MODEL_ID, "device": str(AGENT.device)}).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path != "/predict":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        try:
            payload = json.loads(raw)
            state = payload.get("state", {})
            questions = payload.get("questions", {})
            t1 = time.time()
            res = AGENT.predict(state, questions)
            res["latency_ms"] = round((time.time() - t1) * 1000, 1)
            body = json.dumps(res, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            err = json.dumps({"error": str(e)}, ensure_ascii=False).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(err)))
            self.end_headers()
            self.wfile.write(err)


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()
