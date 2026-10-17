"""Loopback HTTP API for real LLM + CreateOS policy evolution jobs."""

from __future__ import annotations

import importlib.util
import json
import os
import secrets
import sys
from collections.abc import Mapping
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

try:
    from dotenv import load_dotenv
except ImportError:  # Keep the API importable for no-provider unit tests.
    load_dotenv = None

if load_dotenv is not None:
    load_dotenv()

from grid_prix.policy_evolution import (
    CandidateScore,
    CreateOSSandboxClient,
    MissingModelCredentials,
    PolicyEvolution,
    SandboxError,
    generate_llm_candidates,
    score_policy,
    split_training_validation,
    steering_agreement_score,
    trace_transition_dataset,
)

MAX_BODY_BYTES = 2_000_000
MAX_CANDIDATES = 2
BASELINE_SOURCE = """def choose_move(state):
    return {"steering": 0.0, "throttle": 0.0}
"""


class EvolutionRequestError(ValueError):
    """Malformed or unsupported evolution request."""


def readiness() -> dict[str, Any]:
    missing = []
    if not os.getenv("OPENAI_API_KEY"):
        missing.append("OPENAI_API_KEY")
    if not os.getenv("OPENAI_MODEL"):
        missing.append("OPENAI_MODEL")
    if not os.getenv("CREATEOS_API_KEY"):
        missing.append("CREATEOS_API_KEY")
    if importlib.util.find_spec("createos") is None:
        missing.append("createos-sandbox SDK")
    return {
        "available": not missing,
        "status": "ready" if not missing else "unavailable",
        "missing": missing,
        "message": "Ready for real model and sandbox evaluation."
        if not missing
        else f"Configure {', '.join(missing)} in the backend environment.",
    }


def run_evolution_job(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Generate, sandbox-evaluate, and validation-gate real policy source."""
    config = readiness()
    if not config["available"]:
        raise MissingModelCredentials(config["message"])
    seed = payload.get("seed")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise EvolutionRequestError("seed must be an integer")
    race_results = payload.get("race")
    telemetry = payload.get("telemetry")
    if not isinstance(race_results, list) or not all(
        isinstance(item, dict) for item in race_results
    ):
        raise EvolutionRequestError("race must be an array of race result objects")
    if not race_results:
        raise EvolutionRequestError("A completed race is required before evolution")
    if not isinstance(telemetry, list) or not all(
        isinstance(item, dict) for item in telemetry
    ):
        raise EvolutionRequestError("telemetry must be an array of frame objects")

    observations, labels = trace_transition_dataset(telemetry, seed)
    train, train_labels, validation, validation_labels = split_training_validation(
        observations, labels, seed
    )
    if len(train) > 800 or len(validation) > 200:
        raise EvolutionRequestError(
            "benchmark split exceeds configured observation limits"
        )
    generated = generate_llm_candidates(
        train,
        race_results,
        candidate_count=MAX_CANDIDATES,
    )

    expected = {
        (observation["id"], observation["tick"]): label
        for collection, collection_labels in (
            (train, train_labels),
            (validation, validation_labels),
        )
        for observation, label in zip(collection, collection_labels, strict=True)
    }

    def score_actions(states, actions):
        try:
            truth = [expected[(state["id"], state["tick"])] for state in states]
        except KeyError as exc:
            raise ValueError("Unknown telemetry observation in benchmark") from exc
        return steering_agreement_score(states, actions, truth)

    with CreateOSSandboxClient(execution_timeout=30.0) as sandbox_client:
        candidate_errors: tuple[type[BaseException], ...] = (
            SandboxError,
            ValueError,
            TimeoutError,
        )
        try:
            from createos import CreateOSError
        except ImportError:
            pass
        else:
            candidate_errors += (CreateOSError,)

        baseline = score_policy(
            sandbox_client, BASELINE_SOURCE, train, validation, score_actions
        )
        evolution = PolicyEvolution(baseline)
        candidate_scores: list[tuple[str, CandidateScore]] = []
        failures = []
        for candidate in generated.candidates:
            try:
                score = score_policy(
                    sandbox_client, candidate.source, train, validation, score_actions
                )
            except candidate_errors as exc:
                failures.append(f"{candidate.name}: {type(exc).__name__}")
                continue
            candidate_scores.append((candidate.name, score))
            evolution.consider(score)

    accepted = evolution.active.source != BASELINE_SOURCE
    selected_name = next(
        (
            name
            for name, candidate in candidate_scores
            if candidate.source == evolution.active.source
        ),
        "Baseline retained",
    )
    log = [
        f"Analyzed {len(train)} training transitions; held out {len(validation)} deterministic transitions.",
        f"No-op baseline steering agreement: {baseline.validation_score:.3f} held out.",
    ]
    log.extend(
        f"{name}: held-out steering agreement {score.validation_score:.3f}."
        for name, score in candidate_scores
    )
    log.extend(f"Candidate execution failed: {failure}." for failure in failures)
    if not candidate_scores:
        raise SandboxError("No generated policy completed sandbox evaluation")
    summary = (
        generated.analysis.strip()
        or "Model analyzed post-race telemetry and generated policy candidates."
    )
    if accepted:
        summary += (
            " A candidate improved held-out steering agreement over the no-op baseline."
        )
    else:
        summary += " No candidate beat the no-op baseline on held-out steering agreement; baseline retained."
    return {
        "available": True,
        "status": "succeeded" if accepted else "rejected",
        "generation": max(1, int(payload.get("generation", 1) or 1)),
        "candidateName": selected_name,
        "summary": summary,
        "source": evolution.active.source,
        "beforeScore": round(baseline.validation_score * 100, 2),
        "afterScore": round(evolution.active.validation_score * 100, 2),
        "metric": "held-out steering agreement with observed race transitions",
        "analysis": generated.analysis,
        "log": log,
        "accepted": accepted,
        "trainingScore": round(evolution.active.training_score * 100, 2),
    }


class EvolutionHandler(BaseHTTPRequestHandler):
    server_version = "GridPrixEvolution/1.0"

    def _is_local_request(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0].strip("[]").lower()
        if host not in {"localhost", "127.0.0.1", "::1"}:
            return False
        origin = self.headers.get("Origin")
        if origin:
            origin_host = (
                origin.split("://", 1)[-1].split(":", 1)[0].strip("[]").lower()
            )
            if origin_host not in {"localhost", "127.0.0.1", "::1"}:
                return False
        token = os.getenv("GRID_PRIX_EVOLVE_TOKEN")
        if token:
            authorization = self.headers.get("Authorization", "")
            if not secrets.compare_digest(authorization, f"Bearer {token}"):
                return False
        return True

    def _send_json(self, status: HTTPStatus, payload: Mapping[str, Any]) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path not in {"/api/status", "/api/evolve/status"}:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return
        if not self._is_local_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"error": "Local requests only"})
            return
        self._send_json(HTTPStatus.OK, readiness())

    def do_POST(self) -> None:
        if self.path != "/api/evolve":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return
        if not self._is_local_request():
            self._send_json(
                HTTPStatus.FORBIDDEN,
                {"error": "Local requests only or invalid bearer token"},
            )
            return
        if self.headers.get_content_type() != "application/json":
            self._send_json(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                {"error": "Expected application/json"},
            )
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid Content-Length"})
            return
        if not 0 < length <= MAX_BODY_BYTES:
            self._send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": "Request body exceeds 2 MB limit"},
            )
            return
        try:
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise EvolutionRequestError("request must be a JSON object")
            result = run_evolution_job(payload)
        except json.JSONDecodeError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
        except (EvolutionRequestError, ValueError) as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except SandboxError as exc:
            self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": str(exc)})
        except Exception:  # noqa: BLE001 - never return provider exceptions or secrets.
            self._send_json(
                HTTPStatus.BAD_GATEWAY,
                {"error": "Evolution failed; no candidate was accepted."},
            )
        else:
            self._send_json(HTTPStatus.OK, result)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[evolve-api] {fmt % args}", file=sys.stderr)


def main() -> None:
    host = "127.0.0.1"
    port = int(os.getenv("GRID_PRIX_API_PORT", "8787"))
    server = ThreadingHTTPServer((host, port), EvolutionHandler)
    server.daemon_threads = True
    print(f"GRID PRIX evolution API listening on http://{host}:{port}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
