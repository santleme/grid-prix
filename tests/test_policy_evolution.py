import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from grid_prix.policy_evolution import (
    CandidateScore,
    CreateOSSandboxClient,
    MissingSandboxCredentials,
    PolicyEvaluation,
    PolicyEvolution,
    evaluate_policy,
    generate_policy_candidates,
    racing_observation,
)


class PolicyEvolutionTests(unittest.TestCase):
    def test_missing_credentials_fails_closed(self):
        with (
            patch.dict("os.environ", {}, clear=True),
            self.assertRaises(MissingSandboxCredentials),
        ):
            CreateOSSandboxClient()

    def test_evaluation_executes_and_cleans_up_sandbox(self):
        class FakeClient:
            def __init__(self):
                self.calls = []

            def create(self, shape):
                self.calls.append(("create", shape))
                return "sb-test"

            def run(self, sandbox_id, source, observations):
                self.calls.append(("run", sandbox_id, source, observations))
                return PolicyEvaluation(["left"], sandbox_id, 2.5)

            def destroy(self, sandbox_id):
                self.calls.append(("destroy", sandbox_id))

        client = FakeClient()
        observations = [{"speed": 2}]
        evaluation = evaluate_policy(
            client, "def choose_action(observation): return 'left'", observations
        )

        self.assertEqual(evaluation.actions, ["left"])
        self.assertEqual(
            [call[0] for call in client.calls], ["create", "run", "destroy"]
        )

    def test_sdk_runner_uploads_candidate_and_parses_actions(self):
        class SDKStruct:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)

        sdk = types.ModuleType("createos")
        sdk.Client = Mock()
        sdk.ExecOptions = SDKStruct
        sdk.RunCommandRequest = SDKStruct
        with patch.dict(sys.modules, {"createos": sdk}):
            client = CreateOSSandboxClient(api_key="test-key")
        sandbox = SimpleNamespace(id="sb-test", files=SimpleNamespace(upload=Mock()))
        sandbox.run_command = Mock(
            return_value=SimpleNamespace(
                result=SimpleNamespace(
                    exit_code=0,
                    standard_output='__GRID_PRIX_RESULT__:[{"steering":0.5,"throttle":1}]\n',
                    standard_error="",
                ),
                execution_milliseconds=4.2,
            )
        )

        with patch.dict(sys.modules, {"createos": sdk}):
            result = client.run(
                sandbox,
                "def choose_move(state): return {'steering': 0.5, 'throttle': 1}",
                [{"x": 1}],
            )

        self.assertEqual(result.actions, [{"steering": 0.5, "throttle": 1}])
        self.assertEqual(result.sandbox_id, "sb-test")
        self.assertEqual(sandbox.files.upload.call_count, 2)
        options = sandbox.run_command.call_args.args[1]
        self.assertEqual(options.timeout, 30.0)
        self.assertTrue(options.disable_retry)
        client.close()

    def test_cleanup_is_attempted_after_execution_error(self):
        class FakeClient:
            destroyed = False

            def create(self, shape):
                return "sb-test"

            def run(self, sandbox_id, source, observations):
                raise RuntimeError("sandbox execution failed")

            def destroy(self, sandbox_id):
                self.destroyed = True

        client = FakeClient()
        with self.assertRaisesRegex(RuntimeError, "execution failed"):
            evaluate_policy(client, "policy", [{"speed": 1}])
        self.assertTrue(client.destroyed)

    def test_promotion_requires_validation_improvement_and_can_roll_back(self):
        baseline = CandidateScore("baseline", 0.3, 0.4)
        evolution = PolicyEvolution(baseline)
        self.assertFalse(evolution.consider(CandidateScore("overfit", 0.9, 0.2)))
        self.assertTrue(evolution.consider(CandidateScore("better", 0.5, 0.6)))
        self.assertEqual(evolution.active.source, "better")
        self.assertEqual(evolution.rollback(), baseline)

    def test_rollback_without_promoted_candidate_fails(self):
        evolution = PolicyEvolution(CandidateScore("baseline", 0.3, 0.4))
        with self.assertRaisesRegex(RuntimeError, "No previously promoted"):
            evolution.rollback()

    def test_non_finite_scores_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "must be finite"):
            PolicyEvolution(CandidateScore("bad", 0.1, float("nan")))

    def test_candidate_generation_is_seeded_and_emits_python(self):
        first = generate_policy_candidates(seed=42, count=3)
        self.assertEqual(first, generate_policy_candidates(seed=42, count=3))
        self.assertNotEqual(first, generate_policy_candidates(seed=43, count=3))
        for source in first:
            compile(source, "<candidate>", "exec")

    def test_racing_observation_preserves_driver_state_and_adds_target_tick(self):
        state = racing_observation(
            {"id": "driver-1", "x": 1.0}, {"x": 4.0, "y": 2.0}, 12
        )
        self.assertEqual(
            state,
            {"id": "driver-1", "x": 1.0, "target": {"x": 4.0, "y": 2.0}, "tick": 12},
        )


if __name__ == "__main__":
    unittest.main()
