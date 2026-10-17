"""Run Python driving policies and score candidates in CreateOS Sandbox."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Sequence

DEFAULT_SHAPE = "s-1vcpu-1gb"
MAX_OBSERVATIONS = 1000


class SandboxError(RuntimeError):
    """CreateOS SDK or in-sandbox policy execution failed."""


class MissingSandboxCredentials(SandboxError):
    """The CreateOS API key is not configured."""


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


class CreateOSSandboxClient:
    """Thin lifecycle wrapper around the official ``createos-sandbox`` SDK."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        request_timeout: float = 30.0,
        sandbox_wait_timeout: float = 120.0,
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
        self.sandbox_wait_timeout = sandbox_wait_timeout

    def create(self, shape: str = DEFAULT_SHAPE) -> Any:
        from createos import CreateSandboxRequest

        return self._client.create_sandbox(
            CreateSandboxRequest(shape=shape, rootfs="devbox:1")
        )

    def run(self, sandbox: Any, source: str, observations: Sequence[Mapping[str, Any]]) -> PolicyEvaluation:
        from createos import RunCommandRequest

        payload = json.dumps({"source": source, "observations": observations}, separators=(",", ":"))
        sandbox.files.upload("/workspace/grid-prix-input.json", payload.encode("utf-8"))
        sandbox.files.upload("/workspace/grid-prix-run.py", _POLICY_HARNESS.encode("utf-8"))
        response = sandbox.run_command(
            RunCommandRequest(command="python3", arguments=["/workspace/grid-prix-run.py"])
        )
        result = response.result
        exit_code = getattr(result, "exit_code", None)
        if exit_code != 0:
            stderr = getattr(result, "standard_error", "")
            raise SandboxError(f"Policy failed in CreateOS Sandbox: {str(stderr)[:500]}")
        stdout = getattr(result, "standard_output", "")
        marker = "__GRID_PRIX_RESULT__:"
        lines = [line[len(marker):] for line in str(stdout).splitlines() if line.startswith(marker)]
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
                    raise SandboxError(f"Policy action {control} must be finite and between -1 and 1")
        elapsed = getattr(response, "exec_ms", None)
        return PolicyEvaluation(actions, str(sandbox.id), elapsed if isinstance(elapsed, (int, float)) else None)

    @staticmethod
    def destroy(sandbox: Any) -> None:
        sandbox.destroy()

    def close(self) -> None:
        self._client.close()


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


_POLICY_HARNESS = r'''import json
with open("/workspace/grid-prix-input.json", encoding="utf-8") as input_file:
    request = json.load(input_file)
namespace = {}
exec(compile(request["source"], "<driver-policy>", "exec"), namespace)
policy = namespace.get("choose_move")
if not callable(policy):
    raise ValueError("policy must define choose_move(state)")
actions = [policy(observation) for observation in request["observations"]]
print("__GRID_PRIX_RESULT__:" + json.dumps(actions, separators=(",", ":")))
'''
