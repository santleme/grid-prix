"""Production web adapter smoke tests; no model or Sandbox calls are made."""

from __future__ import annotations

import json
import os
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

from grid_prix.webapp import ProductionHandler, app as production_app


class ProductionWebAppTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), ProductionHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def test_serves_frontend_and_public_readiness_without_fake_activity(self) -> None:
        with patch.dict(os.environ, {"GRID_PRIX_PUBLIC_READ_ONLY": "1"}, clear=False):
            with urlopen(f"{self.base_url}/") as response:
                self.assertEqual(response.status, 200)
                self.assertIn(b"GRID PRIX", response.read())
            with urlopen(f"{self.base_url}/api/evolve/status") as response:
                status = json.load(response)
        self.assertEqual(status["status"], "unavailable")
        self.assertFalse(status["available"])

    def test_remote_evolution_post_remains_denied(self) -> None:
        body = b'{"seed": 2026}'
        request = Request(
            f"{self.base_url}/api/evolve",
            data=body,
            headers={"Content-Type": "application/json", "Host": "grid-prix.example"},
            method="POST",
        )
        with patch.dict(os.environ, {"GRID_PRIX_PUBLIC_READ_ONLY": "1"}, clear=False):
            with self.assertRaises(HTTPError) as error:
                urlopen(request)
        self.assertEqual(error.exception.code, 403)

    def test_wsgi_runtime_serves_ui_and_read_only_backend(self) -> None:
        def call(path: str, method: str = "GET") -> tuple[str, bytes]:
            status: list[str] = []

            def start_response(value: str, _headers: list[tuple[str, str]]) -> None:
                status.append(value)

            body = b"".join(production_app(
                {"PATH_INFO": path, "REQUEST_METHOD": method}, start_response
            ))
            return status[0], body

        with patch.dict(os.environ, {"GRID_PRIX_PUBLIC_READ_ONLY": "1"}, clear=False):
            status, body = call("/")
            self.assertEqual(status, "200 OK")
            self.assertIn(b"GRID PRIX", body)
            status, body = call("/api/evolve/status")
            self.assertEqual(status, "200 OK")
            self.assertFalse(json.loads(body)["available"])
            status, _ = call("/api/evolve", method="POST")
            self.assertEqual(status, "403 Forbidden")


if __name__ == "__main__":
    unittest.main()
