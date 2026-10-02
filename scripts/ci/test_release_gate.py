import unittest
from release_gate import require_jobs, valid_run


class ReleaseGateTests(unittest.TestCase):
    def test_only_successful_trusted_exact_sha_passes(self):
        run = dict(head_sha="a" * 40, head_branch="master", event="push",
                   status="completed", conclusion="success")
        self.assertTrue(valid_run(run, "a" * 40))
        for field, value in [("head_sha", "b" * 40), ("head_branch", "feature"),
                             ("event", "pull_request"), ("status", "in_progress"),
                             ("conclusion", "failure"), ("conclusion", "cancelled")]:
            with self.subTest(field=field, value=value):
                self.assertFalse(valid_run({**run, field: value}, "a" * 40))

    def test_skipped_and_missing_native_are_not_green(self):
        for jobs in [[], [{"name": "maestro", "conclusion": "skipped"}],
                     [{"name": "maestro", "conclusion": "failure"}]]:
            with self.assertRaises(RuntimeError):
                require_jobs(jobs, {"maestro"})
        require_jobs([{"name": "maestro", "conclusion": "success"}], {"maestro"})
