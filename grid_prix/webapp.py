"""Production HTTP entry point for the static UI and read-only evolution API."""

from __future__ import annotations

import mimetypes
import json
import os
from collections.abc import Callable
from http import HTTPStatus
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from grid_prix.evolve import EvolutionHandler, _policy_history_view, readiness

STATIC_ROOT = Path(__file__).resolve().parent / "static"


def app(
    environ: dict[str, object],
    start_response: Callable[[str, list[tuple[str, str]]], object],
) -> list[bytes]:
    """WSGI entry point for CreateOS's Python application runtime."""
    method = str(environ.get("REQUEST_METHOD", "GET"))
    route = unquote(str(environ.get("PATH_INFO", "/")))
    if route.startswith("/api/"):
        if method != "GET" or os.getenv("GRID_PRIX_PUBLIC_READ_ONLY") != "1":
            body = b'{"error":"Public evolution is disabled"}'
            start_response("403 Forbidden", [
                ("Content-Type", "application/json; charset=utf-8"),
                ("Content-Length", str(len(body))),
                ("Cache-Control", "no-store"),
            ])
            return [body]
        if route == "/api/evolve/history":
            payload = _policy_history_view()
        elif route in {"/api/status", "/api/evolve/status"}:
            payload = readiness()
        else:
            payload = None
        if payload is None:
            body = b'{"error":"Not found"}'
            status = "404 Not Found"
        else:
            body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
            status = "200 OK"
        start_response(status, [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(body))),
            ("Cache-Control", "no-store"),
        ])
        return [body]

    if route == "/":
        route = "/index.html"
    candidate = (STATIC_ROOT / route.lstrip("/")).resolve()
    try:
        candidate.relative_to(STATIC_ROOT.resolve())
    except ValueError:
        body = b"Not found"
        start_response("404 Not Found", [("Content-Length", str(len(body)))])
        return [body]
    if not candidate.is_file():
        candidate = STATIC_ROOT / "index.html"
    if not candidate.is_file():
        body = b"Frontend build is unavailable"
        start_response("503 Service Unavailable", [("Content-Length", str(len(body)))])
        return [body]
    body = candidate.read_bytes()
    content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
    start_response("200 OK", [
        ("Content-Type", content_type),
        ("Content-Length", str(len(body))),
        ("X-Content-Type-Options", "nosniff"),
        ("Cache-Control", "no-cache" if candidate.name == "index.html" else "public, max-age=31536000, immutable"),
    ])
    return [body]


class ProductionHandler(EvolutionHandler):
    """Serve built assets and expose read-only status on the public host.

    Public evolution POSTs remain denied by the existing local-request check;
    model/Sandbox credentials must never be reachable through an open endpoint.
    """

    def _is_local_request(self) -> bool:
        if self.command in {"GET", "HEAD"} and os.getenv("GRID_PRIX_PUBLIC_READ_ONLY") == "1":
            return True
        # The legacy API's local-only guard also inspects Host/Origin. Require
        # the peer itself to be loopback before relying on those headers;
        # public clients can forge Host: localhost.
        if self.client_address[0] not in {"127.0.0.1", "::1"}:
            return False
        return super()._is_local_request()

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0].startswith("/api/"):
            super().do_GET()
            return
        self._serve_static()

    def do_HEAD(self) -> None:
        self._serve_static(head_only=True)

    def _serve_static(self, *, head_only: bool = False) -> None:
        if not STATIC_ROOT.is_dir():
            self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Frontend build is unavailable"})
            return
        route = unquote(urlsplit(self.path).path)
        if route == "/":
            route = "/index.html"
        candidate = (STATIC_ROOT / route.lstrip("/")).resolve()
        try:
            candidate.relative_to(STATIC_ROOT.resolve())
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not candidate.is_file():
            candidate = STATIC_ROOT / "index.html"
        if not candidate.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = candidate.read_bytes()
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-cache" if candidate.name == "index.html" else "public, max-age=31536000, immutable")
        self.end_headers()
        if not head_only:
            self.wfile.write(body)


def main() -> None:
    if not STATIC_ROOT.is_dir():
        raise SystemExit("Frontend build not found; run npm run build before starting the production server")
    port = int(os.getenv("PORT", os.getenv("GRID_PRIX_API_PORT", "8080")))
    server = ThreadingHTTPServer(("0.0.0.0", port), ProductionHandler)
    server.daemon_threads = True
    print(f"GRID PRIX web app listening on port {port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
