"""Loopback HTTP API for real LLM + CreateOS policy evolution jobs."""

from __future__ import annotations

import importlib.util
import json
import os
import random
import secrets
import sys
import threading
from collections.abc import Mapping
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
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
    InferenceUsage,
    ModelAccessDenied,
    MissingModelCredentials,
    ModelGenerationError,
    PolicyEvolution,
    SandboxError,
    generate_llm_candidates,
    split_training_validation,
    steering_agreement_score,
    trace_transition_dataset,
    validate_policy_source,
)

MAX_BODY_BYTES = 2_000_000
MAX_AGENT_PROMPT_OBSERVATIONS = 24
POLICY_HISTORY_PATH = Path(
    os.getenv("GRID_PRIX_POLICY_HISTORY_PATH", ".grid_prix/driver-policies.json")
)
_EVOLUTION_LOCK = threading.Lock()
_HISTORY_LOCK = threading.Lock()


class EvolutionRequestError(ValueError):
    """Malformed or unsupported evolution request."""


def readiness() -> dict[str, Any]:
    missing = []
    groq_ready = bool(os.getenv("GROQ_API_KEY"))
    openai_ready = bool(os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_MODEL"))
    if not groq_ready and not openai_ready:
        missing.append("GROQ_API_KEY or OPENAI_API_KEY + OPENAI_MODEL")
    if not (os.getenv("CREATEOS_API_KEY") or os.getenv("CREATEOS_PROJECT_API_KEY")):
        missing.append("CREATEOS_PROJECT_API_KEY (or CREATEOS_API_KEY)")
    if importlib.util.find_spec("createos") is None:
        missing.append("createos-sandbox SDK")
    return {
        "available": not missing,
        "status": "ready" if not missing else "unavailable",
        "provider": "groq" if groq_ready else "openai" if openai_ready else None,
        "model": (
            os.getenv("GROQ_MODEL") or "openai/gpt-oss-20b"
            if groq_ready
            else os.getenv("OPENAI_MODEL") if openai_ready else None
        ),
        "sequential": True,
        "missing": missing,
        "message": "Ready for real model and sandbox evaluation."
        if not missing
        else f"Configure {', '.join(missing)} in the backend environment.",
    }


def run_evolution_job(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Sequentially evolve 20 independent policies in one reused Sandbox VM."""
    with _EVOLUTION_LOCK:
        return _run_evolution_job(payload)


def _run_evolution_job(payload: Mapping[str, Any]) -> dict[str, Any]:
    config = readiness()
    if not config["available"]:
        raise MissingModelCredentials(config["message"])
    seed = payload.get("seed")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise EvolutionRequestError("seed must be an integer")
    race_results, telemetry = payload.get("race"), payload.get("telemetry")
    if not isinstance(race_results, list) or len(race_results) != 20 or not all(isinstance(item, dict) for item in race_results):
        raise EvolutionRequestError("A completed 20-driver race is required")
    driver_ids = [item.get("id") for item in race_results]
    if any(not isinstance(value, str) or not value for value in driver_ids) or len(set(driver_ids)) != 20:
        raise EvolutionRequestError("Race results must contain 20 unique driver ids")
    if not isinstance(telemetry, list) or not all(isinstance(item, dict) for item in telemetry):
        raise EvolutionRequestError("telemetry must be an array of frame objects")

    observations, labels = trace_transition_dataset(telemetry, seed)
    grouped = {driver_id: ([], []) for driver_id in driver_ids}
    for observation, label in zip(observations, labels, strict=True):
        group = grouped.get(str(observation.get("id")))
        if group is not None:
            group[0].append(observation)
            group[1].append(label)

    histories = _load_policy_histories()
    agents, run_usages, analyses = [], [], []
    sandbox = None
    sandbox_executions = 0
    provider_blocked = False
    with CreateOSSandboxClient(execution_timeout=30.0) as sandbox_client:
        try:
            for index, race_driver in enumerate(race_results):
                driver_id = race_driver["id"]
                driver_name = str(race_driver.get("name") or driver_id)
                prior = dict(histories.get(driver_id, {}))
                history = list(prior.get("history", []))
                if not history:
                    source = _seed_policy(seed + index * 7_919)
                    history.append({
                        "generation": 0, "name": "Deterministic seeded baseline",
                        "source": source, "validationScore": None, "accepted": True,
                        "provider": "builtin", "model": "grid-prix-seed-policy",
                        "usage": _zero_usage("builtin", "grid-prix-seed-policy"),
                    })
                current = str(prior.get("currentSource") or history[-1]["source"])
                if provider_blocked:
                    histories[driver_id] = {
                        "driverName": driver_name,
                        "currentSource": current,
                        "history": history[-20:],
                        "usage": _add_usage(prior),
                    }
                    agents.append({
                        "driverId": driver_id,
                        "driverName": driver_name,
                        "status": "skipped",
                        "candidateName": "Current policy retained",
                        "accepted": False,
                        "currentSource": current,
                        "history": history[-20:],
                        "usage": _add_usage(prior),
                        "error": "Skipped after the provider denied access.",
                    })
                    continue
                own_observations, own_labels = grouped[driver_id]
                if len(own_observations) < 10:
                    agents.append(_agent_failure(
                        driver_id, driver_name, "Insufficient consecutive telemetry for this driver.",
                        current, history[-20:], prior.get("usage"),
                    ))
                    continue
                train, train_labels, validation, validation_labels = split_training_validation(
                    own_observations, own_labels, seed + index * 104_729
                )
                candidate = None
                usage_record = None
                try:
                    generated = generate_llm_candidates(
                        train[:MAX_AGENT_PROMPT_OBSERVATIONS], [race_driver],
                        candidate_count=1, provider=config["provider"],
                        agent_id=driver_id, agent_name=driver_name,
                        previous_source=current,
                    )
                    if generated.usage:
                        usage_record = _usage_dict(generated.usage)
                        run_usages.append(usage_record)
                    analyses.append(generated.analysis)
                    candidate = generated.candidates[0]
                    try:
                        validate_policy_source(candidate.source)
                    except SandboxError as validation_error:
                        # Repair syntax/shape failures once before spending a Sandbox
                        # execution. Restricted-name/import failures are not repairable.
                        if str(validation_error) != "Policy source is not valid Python":
                            raise
                        repaired = generate_llm_candidates(
                            train[:MAX_AGENT_PROMPT_OBSERVATIONS], [race_driver],
                            candidate_count=1, provider=config["provider"],
                            agent_id=driver_id, agent_name=driver_name,
                            previous_source=current, repair_source=candidate.source,
                            repair_error=str(validation_error),
                        )
                        if repaired.usage:
                            repair_usage = _usage_dict(repaired.usage)
                            run_usages.append(repair_usage)
                            usage_record = _add_usage_record(usage_record, repair_usage)
                        history.append({
                            "generation": len(history), "name": candidate.name,
                            "source": candidate.source, "validationScore": None,
                            "accepted": False, "provider": generated.provider,
                            "model": generated.model,
                            "usage": _usage_dict(generated.usage) if generated.usage else None,
                            "failure": "SyntaxError",
                            "createdAt": datetime.now(timezone.utc).isoformat(),
                        })
                        candidate = None
                        generated = repaired
                        analyses.append(repaired.analysis)
                        candidate = repaired.candidates[0]
                        validate_policy_source(candidate.source)
                    joined, split_at = train + validation, len(train)
                    if sandbox is None:
                        sandbox = sandbox_client.create()
                    base_eval = sandbox_client.run(sandbox, current, joined)
                    sandbox_executions += 1
                    candidate_eval = sandbox_client.run(sandbox, candidate.source, joined)
                    sandbox_executions += 1
                    baseline = CandidateScore(
                        current,
                        steering_agreement_score(train, base_eval.actions[:split_at], train_labels),
                        steering_agreement_score(validation, base_eval.actions[split_at:], validation_labels),
                    )
                    proposal = CandidateScore(
                        candidate.source,
                        steering_agreement_score(train, candidate_eval.actions[:split_at], train_labels),
                        steering_agreement_score(validation, candidate_eval.actions[split_at:], validation_labels),
                    )
                    evolution = PolicyEvolution(baseline)
                    accepted = evolution.consider(proposal)
                    active = evolution.active
                    record = {
                        "generation": len(history), "name": candidate.name,
                        "source": candidate.source,
                        "beforeScore": round(baseline.validation_score * 100, 2),
                        "validationScore": round(proposal.validation_score * 100, 2),
                        "trainingScore": round(proposal.training_score * 100, 2),
                        "accepted": accepted, "provider": generated.provider,
                        "model": generated.model,
                        "usage": usage_record or _zero_usage(generated.provider, generated.model),
                        "createdAt": datetime.now(timezone.utc).isoformat(),
                    }
                    history.append(record)
                    current = active.source
                    cumulative_usage = _add_usage(prior, usage_record)
                    agent = {
                        "driverId": driver_id, "driverName": driver_name,
                        "status": "succeeded" if accepted else "rejected",
                        "candidateName": candidate.name, "accepted": accepted,
                        "beforeScore": round(baseline.validation_score * 100, 2),
                        "afterScore": round(active.validation_score * 100, 2),
                        "trainingScore": round(active.training_score * 100, 2),
                        "currentSource": current, "history": history[-20:],
                        "usage": cumulative_usage, "lastUsage": usage_record,
                    }
                    histories[driver_id] = {
                        "driverName": driver_name, "currentSource": current,
                        "history": history[-20:], "usage": cumulative_usage,
                    }
                    agents.append(agent)
                except (SandboxError, ModelGenerationError, ValueError, TimeoutError) as exc:
                    if isinstance(exc, ModelAccessDenied):
                        provider_blocked = True
                    failed_usage = _failed_request_usage(exc, config["provider"], config["model"])
                    if failed_usage is not None:
                        run_usages.append(failed_usage)
                        usage_record = _add_usage_record(usage_record, failed_usage)
                    if candidate is not None:
                        history.append({
                            "generation": len(history), "name": candidate.name,
                            "source": candidate.source, "validationScore": None,
                            "accepted": False, "provider": config["provider"],
                            "model": config["model"], "usage": usage_record,
                            "failure": type(exc).__name__,
                            "createdAt": datetime.now(timezone.utc).isoformat(),
                        })
                    histories[driver_id] = {
                        "driverName": driver_name, "currentSource": current,
                        "history": history[-20:],
                        "usage": _add_usage(prior, usage_record),
                    }
                    agents.append(_agent_failure(
                        driver_id, driver_name,
                        f"{type(exc).__name__}: {str(exc)[:180]}",
                        current, history[-20:], _add_usage(prior, usage_record), usage_record,
                    ))
        finally:
            if sandbox is not None:
                sandbox_client.destroy(sandbox)

    _save_policy_histories(histories)
    accepted = sum(1 for agent in agents if agent.get("accepted"))
    completed = sum(1 for agent in agents if agent["status"] in {"succeeded", "rejected"})
    usage = {
        "promptTokens": sum(item["promptTokens"] for item in run_usages),
        "completionTokens": sum(item["completionTokens"] for item in run_usages),
        "totalTokens": sum(item["totalTokens"] for item in run_usages),
        "requests": len(run_usages),
        "attempts": sum(item["attempts"] for item in run_usages),
    }
    selected = next((agent for agent in agents if agent.get("accepted")),
                    next((agent for agent in agents if agent["status"] != "failed"), agents[0]))
    return {
        "available": True,
        "status": "succeeded" if accepted else "rejected" if completed else "error",
        "generation": max(1, int(payload.get("generation", 1) or 1)),
        "candidateName": selected.get("candidateName", "Agent policies"),
        "summary": f"Generated and sandbox-tested independent policies for {completed}/20 drivers; "
                   f"{accepted} passed held-out validation. Sequential in one reused CreateOS Sandbox.",
        "source": selected["currentSource"],
        "beforeScore": selected.get("beforeScore"), "afterScore": selected.get("afterScore"),
        "metric": "per-driver held-out steering agreement with observed race transitions",
        "analysis": " ".join(analyses[:3]),
        "log": [
            f"{agent['driverName']}: {'promoted' if agent.get('accepted') else 'retained'} — "
            + (f"held-out {agent.get('afterScore')}%" if agent.get("afterScore") is not None
               else str(agent.get("error") or agent["status"])[:150])
            for agent in agents
        ],
        "accepted": accepted > 0, "trainingScore": selected.get("trainingScore"),
        "provider": config["provider"], "model": config["model"], "sequential": True,
        "sandboxExecutions": sandbox_executions, "usage": usage, "agents": agents,
    }


def _zero_usage(provider: str, model: str) -> dict[str, Any]:
    return {"provider": provider, "model": model, "promptTokens": 0,
            "completionTokens": 0, "totalTokens": 0, "requests": 0, "attempts": 0}


def _seed_policy(seed: int) -> str:
    rng = random.Random(seed)
    gain = rng.uniform(0.06, 0.38)
    throttle = rng.uniform(0.55, 0.95)
    return (
        f"STEERING_GAIN = {gain:.6f}\n"
        f"CRUISE_THROTTLE = {throttle:.6f}\n\n"
        "def choose_move(state):\n"
        "    heading = float(state.get('heading', 0.0))\n"
        "    speed = float(state.get('speed', 0.0))\n"
        "    steering = max(-1.0, min(1.0, -heading * STEERING_GAIN))\n"
        "    throttle = CRUISE_THROTTLE if speed > 0.0 else 1.0\n"
        "    return {'steering': steering, 'throttle': throttle}\n"
    )


def _usage_dict(usage: InferenceUsage) -> dict[str, Any]:
    return {"provider": usage.provider, "model": usage.model,
            "promptTokens": usage.prompt_tokens, "completionTokens": usage.completion_tokens,
            "totalTokens": usage.total_tokens, "requests": 1, "attempts": usage.attempts,
            "requestId": usage.request_id}


def _failed_request_usage(exc: BaseException, provider: str, model: str) -> dict[str, Any] | None:
    if not isinstance(exc, ModelGenerationError) or exc.request_attempts <= 0:
        return None
    return {
        "provider": exc.provider or provider,
        "model": exc.model or model,
        "promptTokens": 0,
        "completionTokens": 0,
        "totalTokens": 0,
        "requests": exc.request_attempts,
        "attempts": exc.request_attempts,
        "estimatedPromptTokens": exc.estimated_prompt_tokens,
    }


def _add_usage(prior: Mapping[str, Any], current: Mapping[str, Any] | None = None) -> dict[str, Any]:
    current = current or _zero_usage("none", "none")
    old = prior.get("usage", {})
    return {
        "provider": current.get("provider", old.get("provider", "none")),
        "model": current.get("model", old.get("model", "none")),
        **{key: int(old.get(key, 0)) + int(current.get(key, 0))
           for key in ("promptTokens", "completionTokens", "totalTokens", "requests", "attempts")},
    }


def _add_usage_record(first: Mapping[str, Any] | None, second: Mapping[str, Any]) -> dict[str, Any]:
    first = first or _zero_usage(str(second.get("provider", "unknown")), str(second.get("model", "unknown")))
    return {
        "provider": second.get("provider", first.get("provider")),
        "model": second.get("model", first.get("model")),
        "promptTokens": int(first.get("promptTokens", 0)) + int(second.get("promptTokens", 0)),
        "completionTokens": int(first.get("completionTokens", 0)) + int(second.get("completionTokens", 0)),
        "totalTokens": int(first.get("totalTokens", 0)) + int(second.get("totalTokens", 0)),
        "requests": int(first.get("requests", 0)) + int(second.get("requests", 0)),
        "attempts": int(first.get("attempts", 0)) + int(second.get("attempts", 0)),
    }


def _agent_failure(driver_id, driver_name, error, current_source, history, usage, last_usage=None):
    return {"driverId": driver_id, "driverName": driver_name, "status": "failed",
            "candidateName": "Current policy retained", "accepted": False,
            "currentSource": current_source, "history": history,
            "usage": dict(usage or _zero_usage("none", "none")),
            "lastUsage": dict(last_usage) if last_usage else None, "error": error}


def _load_policy_histories() -> dict[str, dict[str, Any]]:
    with _HISTORY_LOCK:
        if not POLICY_HISTORY_PATH.exists():
            return {}
        try:
            data = json.loads(POLICY_HISTORY_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise SandboxError("Driver policy history could not be read safely") from exc
        if not isinstance(data, dict):
            raise SandboxError("Driver policy history has an invalid format")
        return {key: value for key, value in data.items()
                if isinstance(key, str) and isinstance(value, dict)}


def _save_policy_histories(histories: Mapping[str, Mapping[str, Any]]) -> None:
    with _HISTORY_LOCK:
        POLICY_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = POLICY_HISTORY_PATH.with_suffix(".tmp")
        temporary.write_text(json.dumps(histories, separators=(",", ":")), encoding="utf-8")
        temporary.replace(POLICY_HISTORY_PATH)


def _policy_history_view() -> dict[str, Any]:
    histories = _load_policy_histories()
    agents = []
    for driver_id, record in histories.items():
        history = list(record.get("history", []))
        last = history[-1] if history else {}
        has_candidate = bool(last and last.get("provider") != "builtin")
        agents.append({
            "driverId": driver_id,
            "driverName": record.get("driverName", driver_id),
            "status": (
                "idle" if not has_candidate else
                "failed" if last.get("failure") else
                "succeeded" if last.get("accepted") else "rejected"
            ),
            "candidateName": last.get("name", "Current policy"),
            "accepted": bool(last.get("accepted")) if has_candidate else False,
            "currentSource": record.get("currentSource"),
            "history": history,
            "usage": record.get("usage", _zero_usage("none", "none")),
        })
    cumulative = {
        "promptTokens": sum(int(agent["usage"].get("promptTokens", 0)) for agent in agents),
        "completionTokens": sum(int(agent["usage"].get("completionTokens", 0)) for agent in agents),
        "totalTokens": sum(int(agent["usage"].get("totalTokens", 0)) for agent in agents),
        "requests": sum(int(agent["usage"].get("requests", 0)) for agent in agents),
        "attempts": sum(int(agent["usage"].get("attempts", 0)) for agent in agents),
    }
    config = readiness()
    return {
        "available": config["available"],
        "status": "idle",
        "provider": config["provider"],
        "model": config["model"],
        "sequential": True,
        "agents": agents,
        "usage": cumulative,
        "generation": max(
            (int(item.get("generation", 0)) for agent in agents for item in agent["history"]),
            default=0,
        ),
        "summary": f"Loaded independent saved policies for {len(agents)} drivers.",
        "log": [],
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
        if self.path not in {
            "/api/status",
            "/api/evolve/status",
            "/api/evolve/history",
        }:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return
        if not self._is_local_request():
            self._send_json(HTTPStatus.FORBIDDEN, {"error": "Local requests only"})
            return
        self._send_json(
            HTTPStatus.OK,
            _policy_history_view()
            if self.path == "/api/evolve/history"
            else readiness(),
        )

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
