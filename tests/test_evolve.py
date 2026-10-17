import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock, patch

from grid_prix.evolve import EvolutionHandler, run_evolution_job
from grid_prix.policy_evolution import (
    CandidateScore,
    CreateOSSandboxClient,
    GeneratedPolicy,
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
                self.assertIn("OPENAI_API_KEY", status["missing"])
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
                self.assertIn("OPENAI_API_KEY", payload["error"])
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

    def test_job_returns_only_sandbox_scored_source_and_metric(self):
        class FakeSandboxClient:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

        training = [{"id": "d", "tick": 1}]
        validation = [{"id": "d", "tick": 2}]
        generated = PolicyGeneration(
            "analysis", [GeneratedPolicy("candidate", "source")]
        )
        baseline = CandidateScore("baseline", 0.4, 0.5)
        candidate = CandidateScore("source", 0.6, 0.7)
        with (
            patch("grid_prix.evolve.readiness", return_value={"available": True}),
            patch(
                "grid_prix.evolve.trace_transition_dataset",
                return_value=(training + validation, [0.1, 0.2]),
            ),
            patch(
                "grid_prix.evolve.split_training_validation",
                return_value=(training, [0.1], validation, [0.2]),
            ),
            patch("grid_prix.evolve.generate_llm_candidates", return_value=generated),
            patch(
                "grid_prix.evolve.CreateOSSandboxClient",
                return_value=FakeSandboxClient(),
            ),
            patch(
                "grid_prix.evolve.score_policy", side_effect=[baseline, candidate]
            ) as scorer,
        ):
            result = run_evolution_job(
                {"seed": 99, "race": [{"place": 1}], "telemetry": frames()}
            )
        self.assertEqual(scorer.call_count, 2)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["source"], "source")
        self.assertEqual(result["beforeScore"], 50)
        self.assertEqual(result["afterScore"], 70)

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
