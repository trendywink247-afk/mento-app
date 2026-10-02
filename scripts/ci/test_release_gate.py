import unittest
from unittest.mock import patch
from release_gate import require_jobs, valid_run, staging


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

    def test_production_rejects_failed_or_untrusted_staging_before_download(self):
        run = dict(path=".github/workflows/staging-release.yml", head_branch="master",
                   event="workflow_dispatch", status="completed", conclusion="success")
        for field, value in [("path", ".github/workflows/test-ci.yml"),
                             ("head_branch", "feature"), ("event", "pull_request"),
                             ("status", "in_progress"), ("conclusion", "failure"),
                             ("conclusion", "cancelled")]:
            with self.subTest(field=field), patch("release_gate.api", return_value={**run, field: value}), patch("release_gate.subprocess.run") as download:
                with self.assertRaises(RuntimeError):
                    staging("owner/repo", "123", "a" * 40)
                download.assert_not_called()

    def test_production_rejects_skipped_acceptance_job(self):
        run = dict(path=".github/workflows/staging-release.yml", head_branch="master",
                   event="workflow_dispatch", status="completed", conclusion="success")
        with patch("release_gate.api", side_effect=[run, {"jobs": [{"name": "stage", "conclusion": "skipped"}]}]), patch("release_gate.subprocess.run") as download:
            with self.assertRaises(RuntimeError):
                staging("owner/repo", "123", "a" * 40)
            download.assert_not_called()
