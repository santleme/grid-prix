"""Run Python driving policies and score candidates in CreateOS Sandbox."""

from __future__ import annotations

import itertools
import json
import math
import os
import random
import urllib.error
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Self, cast
from urllib.parse import urlsplit

DEFAULT_SHAPE = "s-1vcpu-1gb"
MAX_OBSERVATIONS = 1000


class SandboxError(RuntimeError):
    """CreateOS SDK or in-sandbox policy execution failed."""


class MissingSandboxCredentials(SandboxError):
    """The CreateOS API key is not configured."""


class MissingModelCredentials(SandboxError):
    """The OpenAI-compatible model endpoint is not configured."""


class ModelGenerationError(SandboxError):
    """The model endpoint failed or returned an unusable candidate."""


@dataclass(frozen=True)
class PolicyEvaluation:
    actions: list[Any]
    sandbox_id: str
    exec_ms: float | None


@dataclass(frozen=True)
class CandidateScore:
    source: str
    training_score: float
    validation_score: float


@dataclass(frozen=True)
class GeneratedPolicy:
    name: str
    source: str


@dataclass(frozen=True)
class PolicyGeneration:
    analysis: str
    candidates: list[GeneratedPolicy]


class PolicyEvolution:
    """Promote only validated improvements and keep one-step rollback history."""

    def __init__(self, baseline: CandidateScore) -> None:
        self._validate_score(baseline)
        self.active = baseline
        self._history: list[CandidateScore] = []

    def consider(self, candidate: CandidateScore) -> bool:
        self._validate_score(candidate)
        if candidate.validation_score <= self.active.validation_score:
            return False
        self._history.append(self.active)
        self.active = candidate
        return True

    def rollback(self) -> CandidateScore:
        if not self._history:
            raise SandboxError("No previously promoted policy is available to restore")
        self.active = self._history.pop()
        return self.active

    @staticmethod
    def _validate_score(candidate: CandidateScore) -> None:
        if not math.isfinite(candidate.training_score) or not math.isfinite(
            candidate.validation_score
        ):
            raise ValueError("candidate scores must be finite numbers")


class CreateOSSandboxClient:
    """Thin lifecycle wrapper around the official ``createos-sandbox`` SDK."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        request_timeout: float = 30.0,
        execution_timeout: float = 30.0,
    ) -> None:
        self.api_key = api_key or os.getenv("CREATEOS_API_KEY")
        if not self.api_key:
            raise MissingSandboxCredentials(
                "Set CREATEOS_API_KEY to run policies in CreateOS Sandbox; "
                "local execution is intentionally disabled."
            )
        try:
            from createos import Client
        except ImportError as exc:
            raise SandboxError(
                "Install the CreateOS Python SDK with `pip install createos-sandbox`."
            ) from exc
        options: dict[str, Any] = {"api_key": self.api_key, "timeout": request_timeout}
        endpoint = base_url or os.getenv("CREATEOS_SANDBOX_BASE_URL")
        if endpoint:
            options["base_url"] = endpoint
        self._client = Client(**options)
        self.execution_timeout = execution_timeout

    def create(self, shape: str = DEFAULT_SHAPE) -> Any:
        from createos import CreateSandboxRequest, RequestOptions

        return self._client.create_sandbox(
            CreateSandboxRequest(
                shape=shape,
                rootfs="devbox:1",
                # CreateOS treats any non-empty list as a host-enforced
                # allowlist. This TEST-NET address is reserved and unreachable.
                egress_rules=["192.0.2.1:9"],
            ),
            RequestOptions(timeout=120.0),
        )

    def run(
        self, sandbox: Any, source: str, observations: Sequence[Mapping[str, Any]]
    ) -> PolicyEvaluation:
        from createos import ExecOptions, RunCommandRequest

        payload = json.dumps(
            {"source": source, "observations": observations}, separators=(",", ":")
        )
        sandbox.files.upload("/workspace/grid-prix-input.json", payload.encode("utf-8"))
        sandbox.files.upload(
            "/workspace/grid-prix-run.py", _POLICY_HARNESS.encode("utf-8")
        )
        response = sandbox.run_command(
            RunCommandRequest(
                command="python3", arguments=["/workspace/grid-prix-run.py"]
            ),
            ExecOptions(timeout=self.execution_timeout, disable_retry=True),
        )
        result = response.result
        exit_code = getattr(result, "exit_code", None)
        if exit_code != 0:
            stderr = getattr(result, "standard_error", "")
            raise SandboxError(
                f"Policy failed in CreateOS Sandbox: {str(stderr)[:500]}"
            )
        stdout = getattr(result, "standard_output", "")
        marker = "__GRID_PRIX_RESULT__:"
        lines = [
            line[len(marker) :]
            for line in str(stdout).splitlines()
            if line.startswith(marker)
        ]
        if not lines:
            raise SandboxError("Policy execution produced no structured result")
        try:
            actions = json.loads(lines[-1])
        except json.JSONDecodeError as exc:
            raise SandboxError("Policy execution returned invalid JSON") from exc
        if not isinstance(actions, list) or len(actions) != len(observations):
            raise SandboxError("Policy execution returned an invalid action list")
        for action in actions:
            if not isinstance(action, dict):
                raise SandboxError("Each policy action must be an object")
            for control in ("steering", "throttle"):
                value = action.get(control)
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise SandboxError(f"Policy action {control} must be a number")
                if not math.isfinite(value) or not -1 <= value <= 1:
                    raise SandboxError(
                        f"Policy action {control} must be finite and between -1 and 1"
                    )
        elapsed = getattr(response, "execution_milliseconds", None)
        return PolicyEvaluation(
            actions,
            str(sandbox.id),
            elapsed if isinstance(elapsed, (int, float)) else None,
        )

    @staticmethod
    def destroy(sandbox: Any) -> None:
        sandbox.destroy()
        # Reclaim the free-plan sandbox slot before creating the next candidate
        # environment; destroy() only requests deletion asynchronously.
        wait_until_destroyed = getattr(sandbox, "wait_until_destroyed", None)
        if callable(wait_until_destroyed):
            wait_until_destroyed()

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def evaluate_policy(
    client: CreateOSSandboxClient,
    source: str,
    observations: Sequence[Mapping[str, Any]],
    shape: str = DEFAULT_SHAPE,
) -> PolicyEvaluation:
    """Run a policy on observations in a fresh VM and always destroy it."""
    if not source.strip():
        raise ValueError("policy source must not be empty")
    if not observations or len(observations) > MAX_OBSERVATIONS:
        raise ValueError(f"observations must contain 1..{MAX_OBSERVATIONS} items")
    sandbox = client.create(shape)
    try:
        return client.run(sandbox, source, observations)
    finally:
        client.destroy(sandbox)


def score_policy(
    client: CreateOSSandboxClient,
    source: str,
    training: Sequence[Mapping[str, Any]],
    validation: Sequence[Mapping[str, Any]],
    score_actions: Callable[[Sequence[Mapping[str, Any]], Sequence[Any]], float],
) -> CandidateScore:
    """Evaluate a candidate on separate training and held-out validation sets."""
    train = evaluate_policy(client, source, training)
    valid = evaluate_policy(client, source, validation)
    return CandidateScore(
        source=source,
        training_score=float(score_actions(training, train.actions)),
        validation_score=float(score_actions(validation, valid.actions)),
    )


def generate_llm_candidates(
    observations: Sequence[Mapping[str, Any]],
    race_results: Sequence[Mapping[str, Any]],
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    model: str | None = None,
    timeout: float = 20.0,
    candidate_count: int = 2,
) -> PolicyGeneration:
    """Generate policy source from training-only telemetry via chat completions."""
    key = api_key or os.getenv("OPENAI_API_KEY")
    model_name = model or os.getenv("OPENAI_MODEL")
    if not key or not model_name:
        raise MissingModelCredentials(
            "Set OPENAI_API_KEY and OPENAI_MODEL to enable telemetry-driven policy generation."
        )
    if not 1 <= candidate_count <= 2:
        raise ValueError("candidate_count must be 1 or 2")
    endpoint = (
        base_url or os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1"
    ).rstrip("/")
    parsed = urlsplit(endpoint)
    if parsed.scheme != "https" and parsed.hostname not in {
        "localhost",
        "127.0.0.1",
        "::1",
    }:
        raise ValueError(
            "OPENAI_BASE_URL must use HTTPS except for loopback model servers"
        )
    url = (
        endpoint
        if endpoint.endswith("/chat/completions")
        else f"{endpoint}/chat/completions"
    )
    prompt = {
        "candidate_count": candidate_count,
        "training_observations": list(observations),
        "race_results": list(race_results),
    }
    request_data = {
        "model": model_name,
        "temperature": 0,
        "max_tokens": 3000,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "Analyze these real post-race telemetry observations. Return one JSON object only: "
                    "{analysis: string, candidates: [{name: string, source: string}]}. "
                    f"Return exactly {candidate_count} distinct Python policy candidates. Each source must "
                    "define choose_move(state) and return a dict with finite steering and throttle in [-1,1]. "
                    "Use only fields present in the observation. Do not import network, filesystem, subprocess, "
                    "or external packages. Do not claim race improvement; code will be evaluated separately."
                ),
            },
            {"role": "user", "content": json.dumps(prompt, separators=(",", ":"))},
        ],
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(request_data).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_data = json.loads(response.read(1_000_001).decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise ModelGenerationError(f"Model endpoint returned HTTP {exc.code}") from exc
    except (
        urllib.error.URLError,
        TimeoutError,
        json.JSONDecodeError,
        UnicodeDecodeError,
    ) as exc:
        raise ModelGenerationError(f"Model endpoint request failed: {exc}") from exc
    if not isinstance(response_data, dict):
        raise ModelGenerationError("Model endpoint returned an invalid response")
    try:
        content = response_data["choices"][0]["message"]["content"]
        generated = json.loads(content)
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise ModelGenerationError(
            "Model endpoint did not return valid candidate JSON"
        ) from exc
    analysis = generated.get("analysis") if isinstance(generated, dict) else None
    raw_candidates = (
        generated.get("candidates") if isinstance(generated, dict) else None
    )
    if not isinstance(analysis, str) or not isinstance(raw_candidates, list):
        raise ModelGenerationError("Model output must contain analysis and candidates")
    if len(raw_candidates) != candidate_count:
        raise ModelGenerationError(
            f"Model must return exactly {candidate_count} candidates"
        )
    candidates = []
    for index, candidate in enumerate(raw_candidates, start=1):
        if not isinstance(candidate, dict):
            raise ModelGenerationError("Each candidate must be an object")
        name = candidate.get("name")
        source = candidate.get("source")
        if not isinstance(name, str) or not name.strip() or len(name) > 80:
            raise ModelGenerationError(f"Candidate {index} has an invalid name")
        if not isinstance(source, str) or not source.strip() or len(source) > 12_000:
            raise ModelGenerationError(f"Candidate {index} has invalid source")
        if "def choose_move(state)" not in source:
            raise ModelGenerationError(
                f"Candidate {index} must define choose_move(state)"
            )
        candidates.append(GeneratedPolicy(name.strip(), source))
    return PolicyGeneration(analysis.strip()[:600], candidates)


def trace_transition_dataset(
    telemetry: Sequence[Mapping[str, Any]], seed: int, limit: int = MAX_OBSERVATIONS
) -> tuple[list[dict[str, Any]], list[float]]:
    """Extract policy-visible snapshots and private steering labels from frames."""
    if not 10 <= limit <= MAX_OBSERVATIONS:
        raise ValueError(f"limit must be between 10 and {MAX_OBSERVATIONS}")
    frames = sorted(telemetry, key=lambda frame: int(frame.get("tick", -1)))
    transitions: list[tuple[dict[str, Any], float]] = []
    for previous, current in itertools.pairwise(frames):
        previous_tick = int(previous.get("tick", -1))
        tick = int(current.get("tick", -1))
        if tick != previous_tick + 1:
            continue
        previous_drivers = {
            item.get("id"): item
            for item in previous.get("drivers", [])
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        }
        for driver in current.get("drivers", []):
            if not isinstance(driver, dict):
                continue
            driver_id = driver.get("id")
            before = previous_drivers.get(driver_id)
            if before is None:
                continue
            old_heading, old_speed = before.get("heading"), before.get("speed")
            old_x, old_y = before.get("x"), before.get("y")
            new_heading = driver.get("heading")
            new_x, new_y = driver.get("x"), driver.get("y")
            values = (old_heading, old_speed, old_x, old_y, new_heading, new_x, new_y)
            if not all(
                isinstance(value, (int, float)) and math.isfinite(value)
                for value in values
            ):
                continue
            old_heading_value = cast(float, old_heading)
            old_speed_value = cast(float, old_speed)
            old_x_value = cast(float, old_x)
            old_y_value = cast(float, old_y)
            new_heading_value = cast(float, new_heading)
            heading_delta = (new_heading_value - old_heading_value + math.pi) % (
                2 * math.pi
            ) - math.pi
            steering_factor = 0.052 * (0.35 + old_speed_value / 5.4)
            if steering_factor <= 0:
                continue
            expected_steering = max(-1.0, min(1.0, heading_delta / steering_factor))
            state = {
                "id": driver_id,
                "x": old_x_value,
                "y": old_y_value,
                "heading": old_heading_value,
                "speed": old_speed_value,
                "lap": int(before.get("lap", 0)),
                "place": int(before.get("place", 0)),
                "tick": previous_tick,
            }
            transitions.append((state, expected_steering))
    if len(transitions) < 10:
        raise ValueError("At least 10 consecutive driver transitions are required")
    if len(transitions) > limit:
        indices = list(range(len(transitions)))
        random.Random(seed).shuffle(indices)
        transitions = [transitions[index] for index in sorted(indices[:limit])]
    return [state for state, _ in transitions], [label for _, label in transitions]


def split_training_validation(
    observations: Sequence[dict[str, Any]], labels: Sequence[float], seed: int
) -> tuple[list[dict[str, Any]], list[float], list[dict[str, Any]], list[float]]:
    """Deterministically split states/labels without exposing labels to the LLM."""
    if len(observations) != len(labels) or len(observations) < 10:
        raise ValueError("at least 10 matching observation/label pairs are required")
    indices = list(range(len(observations)))
    random.Random(seed).shuffle(indices)
    validation_count = max(2, len(indices) // 5)
    validation_indices = set(indices[:validation_count])
    train_indices = [
        index for index in range(len(indices)) if index not in validation_indices
    ]
    validation_indices_sorted = sorted(validation_indices)
    return (
        [observations[index] for index in train_indices],
        [labels[index] for index in train_indices],
        [observations[index] for index in validation_indices_sorted],
        [labels[index] for index in validation_indices_sorted],
    )


def steering_agreement_score(
    _observations: Sequence[Mapping[str, Any]],
    actions: Sequence[Any],
    expected_steering: Sequence[float],
) -> float:
    """Score held-out steering agreement with observed transitions (range 0..1)."""
    if not actions or len(actions) != len(expected_steering):
        raise ValueError(
            "actions and observed transition labels must have matching items"
        )
    errors = []
    for action, expected in zip(actions, expected_steering, strict=True):
        if not isinstance(action, dict):
            raise TypeError("policy actions must be objects")
        steering = action.get("steering")
        if isinstance(steering, bool) or not isinstance(steering, (int, float)):
            raise TypeError("policy action steering must be numeric")
        errors.append(abs(float(steering) - expected) / 2.0)
    return max(0.0, min(1.0, 1.0 - sum(errors) / len(errors)))


def racing_observation(
    driver_snapshot: Mapping[str, Any], target: Mapping[str, Any], tick: int
) -> dict[str, Any]:
    """Build a JSON-ready observation from the simulation callback arguments."""
    return {**driver_snapshot, "target": dict(target), "tick": tick}


def generate_policy_candidates(seed: int, count: int = 4) -> list[str]:
    """Generate reproducible bounded steering/throttle heuristics for evaluation."""
    if not 1 <= count <= 32:
        raise ValueError("candidate count must be between 1 and 32")
    rng = random.Random(seed)
    candidates = []
    for _ in range(count):
        steering_gain = rng.uniform(0.35, 1.0)
        turn_threshold = rng.uniform(0.2, 0.9)
        candidates.append(
            f"""import math
STEERING_GAIN = {steering_gain!r}
TURN_THRESHOLD = {turn_threshold!r}

def choose_move(state):
    target = state["target"]
    angle = math.atan2(target["y"] - state["y"], target["x"] - state["x"])
    difference = (angle - state["heading"] + math.pi) % (2 * math.pi) - math.pi
    steering = max(-1.0, min(1.0, difference * STEERING_GAIN))
    throttle = 1.0 if abs(difference) <= TURN_THRESHOLD else 0.55
    return {{"steering": steering, "throttle": throttle}}
"""
        )
    return candidates


_POLICY_HARNESS = r"""import json
with open("/workspace/grid-prix-input.json", encoding="utf-8") as input_file:
    request = json.load(input_file)
namespace = {}
exec(compile(request["source"], "<driver-policy>", "exec"), namespace)
policy = namespace.get("choose_move")
if not callable(policy):
    raise ValueError("policy must define choose_move(state)")
actions = [policy(observation) for observation in request["observations"]]
print("__GRID_PRIX_RESULT__:" + json.dumps(actions, separators=(",", ":")))
"""
