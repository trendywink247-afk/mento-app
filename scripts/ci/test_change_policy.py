import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from change_policy import (
    FLAGS, all_flags, changed_paths, classify_event, classify_paths, validate_results,
)


class SelectionTests(unittest.TestCase):
    def test_inert_documentation_skips_every_suite_for_pr_and_push(self):
        paths = ["README.md", "docs/DECISIONS.md", ".claude/skills/mento-verify/SKILL.md",
                 "docs/Mockups/reference.png", "docs/plan.pdf"]
        for event in ("pull_request", "push"):
            self.assertEqual(classify_paths(paths, event), dict.fromkeys(FLAGS, False))

    def test_executable_documentation_and_unknown_paths_select_full(self):
        for path in ("docs/drill.sh", "docs/helper.py", "docs/report.js", "docs/test.ts",
                     "docs/config.yml", "docs/Dockerfile", "architecture.html",
                     "package.json", "services/new_service/main.py", "scripts/local/api.py",
                     "deploy/nginx.conf", "scripts/ci/change_policy.py",
                     ".github/workflows/test-ci.yml", "docs/../services/api/app.py"):
            with self.subTest(path=path):
                self.assertEqual(classify_paths([path]), all_flags())

    def test_api_including_schema_selects_recovery_tooling_and_native(self):
        for path in ("services/api/app/main.py", "services/api/migrations/versions/schema.py",
                     "services/api/requirements.txt", "services/api/Dockerfile"):
            flags = classify_paths([path])
            self.assertEqual({k for k, v in flags.items() if v}, {"api", "tooling", "native"})

    def test_mobile_and_receipt_changes_compose_selectively(self):
        flags = classify_paths(["apps/mobile/app/index.tsx", "services/recovery_receiver/receiver.py"])
        self.assertEqual({k for k, v in flags.items() if v}, {"mobile", "native", "recovery"})

    def test_api_receipt_parser_selects_real_receiver_export_contract(self):
        flags = classify_paths(["services/api/app/services/recovery_manifest.py"])
        self.assertEqual({k for k, v in flags.items() if v}, {"api", "tooling", "native", "recovery"})

    def test_non_doc_push_is_full_and_manual_is_always_full(self):
        self.assertEqual(classify_paths(["services/api/app/main.py"], "push"), all_flags())
        self.assertEqual(classify_event("workflow_dispatch", {}), all_flags())
        self.assertEqual(classify_event("unexpected_event", {}), all_flags())

    def test_missing_zero_or_invalid_refs_fail_closed(self):
        for event in ({}, {"before": "0" * 40, "after": "a" * 40},
                      {"before": "not-a-sha", "after": "a" * 40}, {"before": None}):
            self.assertEqual(classify_event("push", event), all_flags())
        self.assertEqual(classify_event("pull_request", {"pull_request": {}}), all_flags())

    def test_git_failure_and_shallow_checkout_fail_closed(self):
        event = {"before": "a" * 40, "after": "b" * 40}
        with patch("change_policy.subprocess.run", side_effect=subprocess.CalledProcessError(1, "git")):
            self.assertEqual(classify_event("push", event), all_flags())
        with patch("change_policy.subprocess.run", return_value=subprocess.CompletedProcess([], 0, b"true\n")):
            self.assertEqual(classify_event("push", event), all_flags())

    def test_bad_path_or_bad_encoding_never_skips(self):
        for path in ("/README.md", "docs\\README.md", "", None):
            self.assertEqual(classify_paths([path]), all_flags())
        responses = [subprocess.CompletedProcess([], 0, b"false\n"),
                     subprocess.CompletedProcess([], 0, b"docs/\xff.md\0")]
        with patch("change_policy.subprocess.run", side_effect=responses):
            self.assertEqual(classify_event("push", {"before": "a" * 40, "after": "b" * 40}), all_flags())


class AggregateTests(unittest.TestCase):
    def test_selected_success_and_unselected_skip_pass(self):
        validate_results({"api": True, "native": False},
                         {"api": {"result": "success"}, "native": {"result": "skipped"}})

    def test_required_missing_skipped_failed_or_cancelled_is_rejected(self):
        for result in (None, "skipped", "failure", "cancelled", "pending"):
            with self.subTest(result=result), self.assertRaises(RuntimeError):
                validate_results({"api": True}, {"api": result})

    def test_unselected_job_must_have_an_explicit_skip(self):
        for result in (None, "success", "failure", "cancelled"):
            with self.subTest(result=result), self.assertRaises(RuntimeError):
                validate_results({"api": False}, {"api": result})
        with self.assertRaises(RuntimeError):
            validate_results({"api": "false"}, {"api": "skipped"})


class GitRangeTests(unittest.TestCase):
    def setUp(self):
        # Keep even disposable test repositories inside the authorized workspace.
        self.directory = tempfile.TemporaryDirectory(dir=Path(__file__).parent)
        self.repo = Path(self.directory.name)
        self.git("init", "-q")
        self.git("config", "user.email", "ci-test@example.invalid")
        self.git("config", "user.name", "CI policy test")

    def tearDown(self):
        self.directory.cleanup()

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True,
                              capture_output=True, text=True).stdout.strip()

    def commit(self, path, body="test"):
        target = self.repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(body, encoding="utf-8")
        self.git("add", "--", path)
        self.git("commit", "-qm", "test change")
        return self.git("rev-parse", "HEAD")

    def test_push_range_covers_multiple_commits(self):
        base = self.commit("README.md")
        self.commit("services/api/app/main.py")
        head = self.commit("docs/update.md")
        self.assertEqual(classify_event("push", {"before": base, "after": head}, self.repo), all_flags())
        self.assertEqual(set(changed_paths("push", {"before": base, "after": head}, self.repo)),
                         {"services/api/app/main.py", "docs/update.md"})

    def test_pr_merge_base_excludes_new_base_branch_changes(self):
        base = self.commit("README.md")
        self.git("checkout", "-qb", "feature")
        head = self.commit("apps/mobile/example.ts")
        self.git("checkout", "-qb", "base", base)
        newer_base = self.commit("services/api/app/main.py")
        event = {"pull_request": {"base": {"sha": newer_base}, "head": {"sha": head}}}
        self.assertEqual(changed_paths("pull_request", event, self.repo), ["apps/mobile/example.ts"])
        self.assertEqual({k for k, v in classify_event("pull_request", event, self.repo).items() if v},
                         {"mobile", "native"})

    def test_rename_and_deleted_source_cannot_be_hidden_as_documentation(self):
        base = self.commit("services/api/app/old.py")
        self.git("mv", "services/api/app/old.py", "README.md")
        self.git("commit", "-qm", "rename source as docs")
        head = self.git("rev-parse", "HEAD")
        event = {"pull_request": {"base": {"sha": base}, "head": {"sha": head}}}
        self.assertEqual(set(changed_paths("pull_request", event, self.repo)),
                         {"services/api/app/old.py", "README.md"})
        self.assertTrue(classify_event("pull_request", event, self.repo)["api"])
        self.git("rm", "README.md")
        self.git("commit", "-qm", "delete renamed file")
        event["pull_request"]["head"]["sha"] = self.git("rev-parse", "HEAD")
        self.assertTrue(classify_event("pull_request", event, self.repo)["api"])

    def test_nul_paths_keep_spaces_and_missing_commit_fails_closed(self):
        base = self.commit("README.md")
        head = self.commit("apps/mobile/path with spaces.ts")
        event = {"before": base, "after": head}
        self.assertEqual(changed_paths("push", event, self.repo), ["apps/mobile/path with spaces.ts"])
        self.assertEqual(classify_event("push", {"before": "a" * 40, "after": head}, self.repo), all_flags())

    def test_cli_writes_workflow_outputs_and_json(self):
        base = self.commit("README.md", "before")
        head = self.commit("README.md", "after")
        event_file = self.repo / "event.json"
        event_file.write_text(json.dumps({"before": base, "after": head}), encoding="utf-8")
        output_file = self.repo / "outputs.txt"
        import os
        import sys
        result = subprocess.run(
            [sys.executable, str(Path(__file__).with_name("change_policy.py").resolve()),
             "--event-name", "push", "--event-path", str(event_file), "--repo", str(self.repo)],
            env={**os.environ, "GITHUB_OUTPUT": str(output_file)},
            capture_output=True, text=True, check=True,
        )
        self.assertEqual(json.loads(result.stdout), dict.fromkeys(FLAGS, False))
        self.assertEqual(output_file.read_text(encoding="utf-8").splitlines(),
                         [f"{flag}=false" for flag in FLAGS])


if __name__ == "__main__":
    unittest.main()
