import unittest
from unittest.mock import patch

from grid_prix.policy_evolution import (
    CreateOSSandboxClient,
    MissingSandboxCredentials,
    PolicyEvaluation,
    evaluate_policy,
)


class PolicyEvolutionTests(unittest.TestCase):
    def test_missing_credentials_fails_closed(self):
        with patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(MissingSandboxCredentials):
                CreateOSSandboxClient()

    def test_evaluation_executes_and_cleans_up_sandbox(self):
        class FakeClient:
            calls = []

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
        evaluation = evaluate_policy(client, "def choose_action(observation): return 'left'", observations)

        self.assertEqual(evaluation.actions, ["left"])
        self.assertEqual([call[0] for call in client.calls], ["create", "run", "destroy"])

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


if __name__ == "__main__":
    unittest.main()
