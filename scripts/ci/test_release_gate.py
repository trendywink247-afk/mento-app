import unittest
from unittest.mock import patch
from release_gate import REQUIRED, attempt_order, checks, require_jobs, valid_run, staging


class ReleaseGateTests(unittest.TestCase):
    def test_only_successful_trusted_exact_sha_passes(self):
        run = dict(head_sha="a" * 40, head_branch="master", event="push",
                   status="completed", conclusion="success")
        self.assertTrue(valid_run(run, "a" * 40))
        self.assertTrue(valid_run({**run, "event": "workflow_dispatch"}, "a" * 40))
        for field, value in [("head_sha", "b" * 40), ("head_branch", "feature"),
                             ("event", "pull_request"), ("status", "in_progress"),
                             ("conclusion", "failure"), ("conclusion", "cancelled")]:
            with self.subTest(field=field, value=value):
                self.assertFalse(valid_run({**run, field: value}, "a" * 40))

    def ci_run(self, run_id=123, **overrides):
        return {**dict(head_sha="a" * 40, head_branch="master", event="push",
                       status="completed", conclusion="success", id=run_id,
                       run_attempt=1, created_at="2026-10-05T01:00:00Z",
                       run_started_at="2026-10-05T01:00:00Z",
                       updated_at="2026-10-05T01:00:00Z"), **overrides}

    def mock_checks(self, runs, jobs=None):
        def response(path):
            if "/jobs?" in path:
                return {"jobs": jobs or [{"name": name, "conclusion": "success"}
                                         for name in REQUIRED["api-ci.yml"]]}
            self.assertNotIn("event=push", path)
            self.assertIn("head_sha=" + "a" * 40, path)
            return {"workflow_runs": runs}
        return patch("release_gate.api", side_effect=response), patch.dict(
            "release_gate.REQUIRED", {"api-ci.yml": REQUIRED["api-ci.yml"]}, clear=True)

    def test_trusted_dispatch_provides_full_suite_evidence(self):
        mocked_api, workflows = self.mock_checks([self.ci_run(event="workflow_dispatch")])
        with mocked_api, workflows:
            self.assertEqual(checks("owner/repo", "a" * 40),
                             {"api-ci.yml": {"run_id": 123, "attempt": 1}})

    def test_latest_failure_cannot_be_hidden_by_older_success_or_newer_pr(self):
        runs = [self.ci_run(125, event="pull_request", run_started_at="2026-10-05T03:00:00Z"),
                self.ci_run(124, conclusion="failure", run_started_at="2026-10-05T02:00:00Z"),
                self.ci_run()]
        mocked_api, workflows = self.mock_checks(runs)
        with mocked_api as request, workflows:
            with self.assertRaisesRegex(RuntimeError, "latest trusted"):
                checks("owner/repo", "a" * 40)
            self.assertEqual(request.call_count, 1)

    def test_newly_started_failed_rerun_of_older_run_blocks_release(self):
        runs = [self.ci_run(124), self.ci_run(123, conclusion="failure", run_attempt=2,
                                            run_started_at="2026-10-05T02:00:00Z")]
        mocked_api, workflows = self.mock_checks(runs)
        with mocked_api, workflows:
            with self.assertRaises(RuntimeError):
                checks("owner/repo", "a" * 40)

    def test_new_full_dispatch_supersedes_previous_failed_or_docs_evidence(self):
        runs = [self.ci_run(124, event="workflow_dispatch", run_attempt=2,
                            run_started_at="2026-10-05T02:00:00Z"),
                self.ci_run(123, conclusion="failure")]
        mocked_api, workflows = self.mock_checks(runs)
        with mocked_api, workflows:
            self.assertEqual(checks("owner/repo", "a" * 40)["api-ci.yml"],
                             {"run_id": 124, "attempt": 2})

    def test_latest_incomplete_or_cancelled_run_cannot_reuse_previous_success(self):
        for overrides in [dict(status="in_progress", conclusion=None),
                          dict(conclusion="cancelled")]:
            runs = [self.ci_run(124, run_started_at="2026-10-05T02:00:00Z", **overrides),
                    self.ci_run()]
            mocked_api, workflows = self.mock_checks(runs)
            with self.subTest(overrides=overrides), mocked_api, workflows:
                with self.assertRaises(RuntimeError):
                    checks("owner/repo", "a" * 40)

    def test_latest_docs_run_requires_full_dispatch_even_after_prior_success(self):
        jobs = [{"name": name, "conclusion": "success" if name in {"lint", "test"}
                 else "skipped"} for name in REQUIRED["api-ci.yml"]]
        mocked_api, workflows = self.mock_checks([
            self.ci_run(124, run_started_at="2026-10-05T02:00:00Z"), self.ci_run()], jobs)
        with mocked_api, workflows:
            with self.assertRaisesRegex(RuntimeError, "missing, skipped or unsuccessful"):
                checks("owner/repo", "a" * 40)

    def test_markerless_historical_success_is_not_accepted(self):
        jobs = [{"name": name, "conclusion": "success"}
                for name in REQUIRED["api-ci.yml"] if name != "full-suite"]
        mocked_api, workflows = self.mock_checks([self.ci_run()], jobs)
        with mocked_api, workflows:
            with self.assertRaises(RuntimeError):
                checks("owner/repo", "a" * 40)

    def test_older_success_completing_late_cannot_hide_newer_failure(self):
        runs = [self.ci_run(124, conclusion="failure",
                            run_started_at="2026-10-05T02:00:00Z",
                            updated_at="2026-10-05T02:10:00Z"),
                self.ci_run(123, updated_at="2026-10-05T03:00:00Z")]
        mocked_api, workflows = self.mock_checks(runs)
        with mocked_api as request, workflows:
            with self.assertRaisesRegex(RuntimeError, "latest trusted"):
                checks("owner/repo", "a" * 40)
            self.assertEqual(request.call_count, 1)

    def test_older_success_completing_late_cannot_hide_newer_docs_skip(self):
        runs = [self.ci_run(124, run_started_at="2026-10-05T02:00:00Z",
                            updated_at="2026-10-05T02:10:00Z"),
                self.ci_run(123, updated_at="2026-10-05T03:00:00Z")]
        def response(path):
            if "/jobs?" not in path:
                return {"workflow_runs": runs}
            return {"jobs": [{"name": name, "conclusion":
                              "skipped" if "/124/" in path and name == "full-suite" else "success"}
                             for name in REQUIRED["api-ci.yml"]]}
        with patch("release_gate.api", side_effect=response), patch.dict(
                "release_gate.REQUIRED", {"api-ci.yml": REQUIRED["api-ci.yml"]}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "missing, skipped or unsuccessful"):
                checks("owner/repo", "a" * 40)

    def test_queued_new_run_creation_blocks_previous_success(self):
        runs = [self.ci_run(124, status="queued", conclusion=None, run_started_at=None,
                            created_at="2026-10-05T02:00:00Z"), self.ci_run()]
        mocked_api, workflows = self.mock_checks(runs)
        with mocked_api, workflows:
            with self.assertRaisesRegex(RuntimeError, "pending trusted"):
                checks("owner/repo", "a" * 40)

    def test_missing_or_malformed_attempt_timestamp_fails_closed(self):
        for overrides in [dict(run_started_at=None, created_at=None),
                          dict(run_started_at="bad"),
                          dict(run_started_at="2026-10-05T01:00:00")]:
            with self.subTest(overrides=overrides), self.assertRaisesRegex(RuntimeError, "timestamp"):
                attempt_order(self.ci_run(**overrides))

    def test_pending_older_rerun_with_stale_start_blocks_newer_success(self):
        runs = [self.ci_run(124, run_started_at="2026-10-05T02:00:00Z"),
                self.ci_run(123, run_attempt=2, status="queued", conclusion=None)]
        mocked_api, workflows = self.mock_checks(runs)
        with mocked_api as request, workflows:
            with self.assertRaisesRegex(RuntimeError, "pending trusted"):
                checks("owner/repo", "a" * 40)
            self.assertEqual(request.call_count, 1)

    def test_truncated_evidence_fails_closed_before_job_lookup(self):
        with patch("release_gate.api", return_value={
                "workflow_runs": [self.ci_run()], "total_count": 101}) as request:
            with self.assertRaisesRegex(RuntimeError, "truncated workflow evidence"):
                checks("owner/repo", "a" * 40)
            self.assertEqual(request.call_count, 1)

    def test_pr_other_branch_or_wrong_sha_cannot_provide_evidence(self):
        for field, value in [("event", "pull_request"), ("head_branch", "feature"),
                             ("head_sha", "b" * 40), ("event", "schedule")]:
            mocked_api, workflows = self.mock_checks([self.ci_run(**{field: value})])
            with self.subTest(field=field, value=value), mocked_api, workflows:
                with self.assertRaises(RuntimeError):
                    checks("owner/repo", "a" * 40)

    def test_release_requires_every_heavy_job_and_full_marker(self):
        for workflow, expected in REQUIRED.items():
            for absent in expected:
                jobs = [{"name": name, "conclusion": "success"}
                        for name in expected if name != absent]
                with self.subTest(workflow=workflow, absent=absent), self.assertRaises(RuntimeError):
                    require_jobs(jobs, expected)

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
