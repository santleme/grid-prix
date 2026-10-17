import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from grid_prix.evolve import EvolutionHandler, readiness, run_evolution_job
from grid_prix.policy_evolution import (
    CandidateScore,
    CreateOSSandboxClient,
    GeneratedPolicy,
    InferenceUsage,
    ModelAccessDenied,
    MissingModelCredentials,
    ModelGenerationError,
    PolicyGeneration,
    generate_llm_candidates,
    split_training_validation,
    steering_agreement_score,
    trace_transition_dataset,
)


def frames(count=12):
    return [
        {
            "tick": tick,
            "drivers": [
                {
                    "id": "driver-1",
                    "x": tick * 0.1,
                    "y": 1.0,
                    "heading": tick * 0.04,
                    "speed": 3.0,
                    "lap": 0,
                    "place": 1,
                }
            ],
        }
        for tick in range(1, count + 1)
    ]


class EvolutionApiTests(unittest.TestCase):
    def test_readiness_accepts_stripe_projects_createos_key(self):
        with patch.dict(
            os.environ,
            {
                "CREATEOS_PROJECT_API_KEY": "project-key",
                "GROQ_API_KEY": "model-key",
            },
            clear=True,
        ):
            with patch(
                "grid_prix.evolve.importlib.util.find_spec", return_value=object()
            ):
                status = readiness()

        self.assertTrue(status["available"])
        self.assertEqual(status["missing"], [])
        self.assertEqual(status["provider"], "groq")
        self.assertEqual(status["model"], "openai/gpt-oss-20b")

    def test_destroy_waits_for_sandbox_reclamation(self):
        sandbox = SimpleNamespace(destroy=Mock(), wait_until_destroyed=Mock())
        CreateOSSandboxClient.destroy(sandbox)
        sandbox.destroy.assert_called_once_with()
        sandbox.wait_until_destroyed.assert_called_once_with()

    def test_local_http_status_and_missing_key_error_fail_closed(self):
        from http.server import ThreadingHTTPServer

        server = ThreadingHTTPServer(("127.0.0.1", 0), EvolutionHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{server.server_port}"
        try:
            with patch.dict(os.environ, {}, clear=True):
                with urllib.request.urlopen(
                    f"{base_url}/api/evolve/status"
                ) as response:
                    status = json.loads(response.read())
                self.assertFalse(status["available"])
                self.assertIn("GROQ_API_KEY or OPENAI_API_KEY + OPENAI_MODEL", status["missing"])
                foreign_origin = urllib.request.Request(
                    f"{base_url}/api/status", headers={"Origin": "https://example.com"}
                )
                with self.assertRaises(urllib.error.HTTPError) as denied:
                    urllib.request.urlopen(foreign_origin)
                self.assertEqual(denied.exception.code, 403)
                request = urllib.request.Request(
                    f"{base_url}/api/evolve",
                    data=json.dumps({"seed": 1, "race": [], "telemetry": []}).encode(),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                with self.assertRaises(urllib.error.HTTPError) as error:
                    urllib.request.urlopen(request)
                self.assertEqual(error.exception.code, 503)
                payload = json.loads(error.exception.read())
                self.assertIn("GROQ_API_KEY", payload["error"])
                self.assertNotIn("source", payload)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=1)

    def test_openai_generator_fails_closed_without_key_or_model(self):
        with (
            patch.dict(os.environ, {}, clear=True),
            self.assertRaises(MissingModelCredentials),
        ):
            generate_llm_candidates([{"tick": 1}], [], api_key=None, model=None)

    def test_openai_generator_parses_real_compatible_chat_response(self):
        content = json.dumps(
            {
                "analysis": "Steering changes track heading.",
                "candidates": [
                    {
                        "name": "Telemetry driver",
                        "source": "def choose_move(state):\n return {'steering':0,'throttle':1}",
                    }
                ],
            }
        )
        response = BytesIO(
            json.dumps({"choices": [{"message": {"content": content}}]}).encode()
        )
        with patch(
            "grid_prix.policy_evolution.urllib.request.urlopen", return_value=response
        ) as request:
            generated = generate_llm_candidates(
                [{"tick": 2}],
                [],
                api_key="secret",
                model="compatible-model",
                candidate_count=1,
            )
        self.assertEqual(generated.analysis, "Steering changes track heading.")
        self.assertEqual(generated.candidates[0].name, "Telemetry driver")
        self.assertIn("choose_move(state)", generated.candidates[0].source)
        request_data = json.loads(request.call_args.args[0].data)
        self.assertEqual(
            request.call_args.args[0].headers.get("Authorization"), "Bearer secret"
        )
        self.assertNotIn("secret", json.dumps(request_data["messages"]))

    def test_openai_generator_rejects_invalid_candidate_shape(self):
        content = json.dumps(
            {"analysis": "", "candidates": [{"name": "bad", "source": "print(1)"}]}
        )
        response = BytesIO(
            json.dumps({"choices": [{"message": {"content": content}}]}).encode()
        )
        with (
            patch(
                "grid_prix.policy_evolution.urllib.request.urlopen",
                return_value=response,
            ),
            self.assertRaises(ModelGenerationError),
        ):
            generate_llm_candidates(
                [{"tick": 1}], [], api_key="key", model="model", candidate_count=1
            )

    def test_transition_dataset_uses_consecutive_frames_and_is_reproducible(self):
        telemetry = frames(15)
        observations, labels = trace_transition_dataset(telemetry, seed=77)
        repeated, repeated_labels = trace_transition_dataset(telemetry, seed=77)
        self.assertEqual(observations, repeated)
        self.assertEqual(labels, repeated_labels)
        self.assertEqual(len(observations), 14)
        self.assertTrue(all("expected" not in str(state) for state in observations))
        gapped = [telemetry[0], telemetry[2], *telemetry[3:]]
        gapped_observations, _ = trace_transition_dataset(gapped, seed=77)
        self.assertEqual(len(gapped_observations), 12)

    def test_split_is_stable_disjoint_and_action_metric_is_bounded(self):
        observations = [{"id": "d", "tick": index} for index in range(20)]
        labels = [0.5] * len(observations)
        first = split_training_validation(observations, labels, 21)
        self.assertEqual(first, split_training_validation(observations, labels, 21))
        train, _, validation, _ = first
        self.assertFalse(
            {item["tick"] for item in train} & {item["tick"] for item in validation}
        )
        self.assertEqual(
            steering_agreement_score(
                train, [{"steering": 0.5}] * len(train), [0.5] * len(train)
            ),
            1,
        )
        self.assertEqual(
            steering_agreement_score(
                train, [{"steering": -1}] * len(train), [0.5] * len(train)
            ),
            0.25,
        )

    def test_job_keeps_twenty_driver_policies_independent_and_reuses_one_sandbox(self):
        class FakeSandboxClient:
            instances = []

            def __init__(self, **_kwargs):
                self.sandbox = SimpleNamespace(id="sandbox-1")
                self.created = 0
                self.destroyed = 0
                self.sources = []
                FakeSandboxClient.instances.append(self)

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

            def create(self):
                self.created += 1
                return self.sandbox

            def run(self, sandbox, source, observations):
                self.assert_sandbox(sandbox)
                self.sources.append(source)
                return SimpleNamespace(
                    actions=[{"steering": 0.0, "throttle": 1.0} for _ in observations],
                    sandbox_id="sandbox-1",
                    exec_ms=1.0,
                )

            def assert_sandbox(self, sandbox):
                if sandbox is not self.sandbox:
                    raise AssertionError("must reuse one sandbox handle")

            def destroy(self, sandbox):
                self.assert_sandbox(sandbox)
                self.destroyed += 1

        drivers = [{"id": f"driver-{index:02}", "name": f"Driver {index:02}"} for index in range(20)]
        samples = [({"id": driver["id"], "tick": tick}, 0.0) for driver in drivers for tick in range(10)]

        def generate(_observations, _race, **kwargs):
            driver_id = kwargs["agent_id"]
            usage = InferenceUsage("groq", "openai/gpt-oss-20b", 100, 50, 150, 1)
            if driver_id == "driver-00" and not kwargs.get("repair_source"):
                return PolicyGeneration(
                    f"analysis for {driver_id}",
                    [GeneratedPolicy("broken", "def choose_move(state): return {")],
                    "groq", "openai/gpt-oss-20b", usage,
                )
            if kwargs.get("repair_source"):
                self.assertIn("return {", kwargs["repair_source"])
                self.assertEqual(kwargs["repair_error"], "Policy source is not valid Python")
            return PolicyGeneration(
                f"analysis for {driver_id}",
                [GeneratedPolicy(f"candidate {driver_id}", f"# {driver_id}\ndef choose_move(state): return {{'steering': 0.0, 'throttle': 1.0}}")],
                "groq", "openai/gpt-oss-20b", usage,
            )

        with tempfile.TemporaryDirectory() as temp_dir:
            with (
                patch(
                    "grid_prix.evolve.POLICY_HISTORY_PATH",
                    Path(temp_dir) / "policies.json",
                ),
                patch(
                    "grid_prix.evolve.readiness",
                    return_value={
                        "available": True,
                        "provider": "groq",
                        "model": "openai/gpt-oss-20b",
                    },
                ),
                patch(
                    "grid_prix.evolve.trace_transition_dataset",
                    return_value=(
                        [item for item, _ in samples],
                        [label for _, label in samples],
                    ),
                ),
                patch(
                    "grid_prix.evolve.split_training_validation",
                    side_effect=lambda obs, labels, seed: (
                        obs[:8], labels[:8], obs[8:], labels[8:]
                    ),
                ),
                patch(
                    "grid_prix.evolve.generate_llm_candidates",
                    side_effect=generate,
                ) as generator,
                patch("grid_prix.evolve.CreateOSSandboxClient", FakeSandboxClient),
            ):
                result = run_evolution_job({"seed": 99, "race": drivers, "telemetry": frames()})

        client = FakeSandboxClient.instances[-1]
        self.assertEqual(generator.call_count, 21)
        self.assertEqual(client.created, 1)
        self.assertEqual(client.destroyed, 1)
        self.assertEqual(len(set(client.sources[::2])), 20)
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(len(result["agents"]), 20)
        self.assertEqual(len({agent["driverId"] for agent in result["agents"]}), 20)
        self.assertEqual(result["usage"]["totalTokens"], 3_150)
        self.assertEqual(result["usage"]["requests"], 21)
        repaired_agent = next(agent for agent in result["agents"] if agent["driverId"] == "driver-00")
        self.assertEqual(repaired_agent["usage"]["requests"], 2)
        self.assertTrue(any(item.get("failure") == "SyntaxError" for item in repaired_agent["history"]))
        self.assertFalse(any(source == "def choose_move(state): return {" for source in client.sources))
        self.assertEqual(result["sandboxExecutions"], 40)
        self.assertTrue(all(len(agent["history"]) == (3 if agent["driverId"] == "driver-00" else 2)
                            for agent in result["agents"]))

    def test_provider_access_denial_stops_further_calls_without_creating_sandbox(self):
        class FakeSandboxClient:
            created = 0

            def __init__(self, **_kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

            def create(self):
                self.created += 1
                raise AssertionError("no sandbox should be created without a candidate")

        drivers = [{"id": f"driver-{index:02}", "name": f"Driver {index:02}"} for index in range(20)]
        observations = [{"id": driver["id"], "tick": tick} for driver in drivers for tick in range(10)]
        labels = [0.0] * len(observations)
        with tempfile.TemporaryDirectory() as temp_dir:
            with (
                patch("grid_prix.evolve.POLICY_HISTORY_PATH", Path(temp_dir) / "policies.json"),
                patch("grid_prix.evolve.readiness", return_value={"available": True, "provider": "groq", "model": "openai/gpt-oss-20b"}),
                patch("grid_prix.evolve.trace_transition_dataset", return_value=(observations, labels)),
                patch("grid_prix.evolve.split_training_validation", side_effect=lambda obs, vals, _seed: (obs[:8], vals[:8], obs[8:], vals[8:])),
                patch("grid_prix.evolve.CreateOSSandboxClient", FakeSandboxClient),
                patch("grid_prix.evolve.generate_llm_candidates", side_effect=ModelAccessDenied("Groq access denied")) as generate,
            ):
                result = run_evolution_job({"seed": 99, "race": drivers, "telemetry": frames()})

        self.assertEqual(generate.call_count, 1)
        self.assertEqual(FakeSandboxClient.created, 0)
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["agents"][0]["status"], "failed")
        self.assertTrue(all(agent["status"] == "skipped" for agent in result["agents"][1:]))

    def test_sdk_create_locks_outbound_egress(self):
        class SDKValue:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)

        sdk = SimpleNamespace(
            Client=Mock(),
            CreateSandboxRequest=SDKValue,
            RequestOptions=SDKValue,
        )
        with patch.dict("sys.modules", {"createos": sdk}):
            client = CreateOSSandboxClient(api_key="test")
            client.create()
        request = client._client.create_sandbox.call_args.args[0]
        self.assertEqual(request.egress_rules, ["192.0.2.1:9"])
        client.close()


if __name__ == "__main__":
    unittest.main()
