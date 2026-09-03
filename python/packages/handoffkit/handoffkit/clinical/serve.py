"""Stdlib HTTP service for clinical v1beta. Loopback demo only. Snapshot, not a live SSE stream."""

from __future__ import annotations

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from handoffkit.clinical.constants import MAX_BODY_BYTES
from handoffkit.clinical.engine import ClinicalLab
from handoffkit.clinical.errors import ClinicalError
from handoffkit.clinical.store import safe_run_id

PREFIX = "/api/clinical/v1beta"


class ClinicalHandler(BaseHTTPRequestHandler):
    lab: ClinicalLab
    bind_loopback: bool = True
    _hits: dict[str, list[float]]

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def _client(self) -> str:
        return str(self.client_address[0] if self.client_address else "")

    def _rate_limit(self) -> None:
        now = time.time()
        bucket = type(self)._hits.setdefault(self._client(), [])
        type(self)._hits[self._client()] = [item for item in bucket if now - item < 10]
        if len(type(self)._hits[self._client()]) >= 60:
            raise ClinicalError("rate limit exceeded", code="invalid_request")
        type(self)._hits[self._client()].append(now)

    def _loopback(self) -> None:
        if not self.bind_loopback:
            return
        host = (self.headers.get("Host") or "").split(":")[0].lower()
        if host and host not in {"127.0.0.1", "localhost", "::1"}:
            raise ClinicalError("clinical demo is restricted to loopback", code="invalid_request")

    def _json(self, status: int, payload: dict[str, Any] | list[Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Clinical-Stream", "snapshot")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            raise ClinicalError("request body too large", code="invalid_request")
        raw = self.rfile.read(length) if length else b"{}"
        if len(raw) > MAX_BODY_BYTES:
            raise ClinicalError("request body too large", code="invalid_request")
        data = json.loads(raw.decode("utf-8") or "{}")
        return data if isinstance(data, dict) else {}

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        try:
            self._loopback()
            self._rate_limit()
            if path == f"{PREFIX}/manifests":
                self._json(200, {"manifests": self.lab.manifests()})
                return
            if path.startswith(f"{PREFIX}/runs/") and path.endswith("/events"):
                run_id = safe_run_id(path.split("/")[-2])
                run = self.lab.get_run(run_id)
                self._json(200, {"stream": "snapshot", "run": run.to_wire()})
                return
            if path.startswith(f"{PREFIX}/runs/"):
                self._json(200, self.lab.get_run(safe_run_id(path.rsplit("/", 1)[-1])).to_wire())
                return
            if path.startswith(f"{PREFIX}/benchmarks/") and path.endswith("/report"):
                bench_id = path.split("/")[-2]
                self._json(200, self.lab.report(bench_id))
                return
            if path.startswith(f"{PREFIX}/benchmarks/"):
                self._json(200, self.lab.get_benchmark(path.rsplit("/", 1)[-1]))
                return
            self._json(404, {"code": "invalid_request", "message": "not found"})
        except ClinicalError as exc:
            self._json(400, exc.to_wire())

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        try:
            self._loopback()
            self._rate_limit()
            body = self._read_json()
            if path == f"{PREFIX}/runs":
                run = self.lab.create_run(body)
                self._json(201, run.to_wire())
                return
            if path.startswith(f"{PREFIX}/runs/") and path.endswith("/actions"):
                run_id = safe_run_id(path.split("/")[-2])
                run = self.lab.act(run_id, body)
                self._json(200, run.to_wire())
                return
            if path == f"{PREFIX}/benchmarks":
                self._json(201, self.lab.start_benchmark(body))
                return
            self._json(404, {"code": "invalid_request", "message": "not found"})
        except ClinicalError as exc:
            self._json(400, exc.to_wire())


def serve(host: str = "127.0.0.1", port: int = 8787, lab: ClinicalLab | None = None) -> None:
    handler = type(
        "BoundHandler",
        (ClinicalHandler,),
        {
            "lab": lab or ClinicalLab(),
            "bind_loopback": host in {"127.0.0.1", "localhost", "::1"},
            "_hits": {},
        },
    )
    server = ThreadingHTTPServer((host, port), handler)
    print(f"clinical v1beta listening on http://{host}:{port}{PREFIX}")
    server.serve_forever()
