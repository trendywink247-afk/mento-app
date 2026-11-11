"""Production deploy guards (ops/lib/prod-guards.sh, ops/prod-release.sh).

Founder rule: production deploys only commits on origin/main, and only what the local CI
gate passed. These tests build a throwaway origin with `main` and `dev`, then check that the
guards accept a main commit with a passing CI log and refuse everything else, and that
prod-release.sh refuses without --yes-production and in --dry-run changes nothing.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GUARDS = ROOT / "ops" / "lib" / "prod-guards.sh"
RELEASE = ROOT / "ops" / "prod-release.sh"
SUMMARY = "ops/ci: ---- summary ----"


def sh(*args: str, cwd: Path | None = None, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, check=False)


def git(repo: Path, *args: str) -> str:
    out = sh("git", "-C", str(repo), *args)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip()


class ProdGuards(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="prod-guards-"))
        env_id = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false"]
        work = self.tmp / "work"
        sh("git", "init", "-q", "-b", "main", str(work))
        (work / "a.txt").write_text("one\n")
        git(work, "add", "a.txt")
        git(work, *env_id, "commit", "-q", "-m", "on main")
        self.main_sha = git(work, "rev-parse", "HEAD")
        git(work, "checkout", "-q", "-b", "dev")
        (work / "a.txt").write_text("two\n")
        git(work, *env_id, "commit", "-q", "-am", "dev only")
        self.dev_sha = git(work, "rev-parse", "HEAD")
        origin = self.tmp / "origin.git"
        sh("git", "clone", "-q", "--bare", str(work), str(origin))
        self.repo = self.tmp / "checkout"
        sh("git", "clone", "-q", str(origin), str(self.repo))
        self.logs = self.tmp / "ci"
        self.logs.mkdir()

    def tearDown(self) -> None:
        subprocess.run(["rm", "-rf", str(self.tmp)], check=False)

    def guard(self, fn: str, *args: str) -> subprocess.CompletedProcess:
        return sh("bash", "-c", f'. "{GUARDS}"; {fn} "$@"', "_", *args)

    def write_log(self, sha: str, body: str) -> None:
        (self.logs / f"{sha}.log").write_text(body)

    # --- on main ---------------------------------------------------------------------
    def test_main_commit_is_accepted_and_full_sha_printed(self) -> None:
        out = self.guard("prod_on_main", str(self.repo), self.main_sha[:12])
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertEqual(out.stdout.strip(), self.main_sha)

    def test_dev_only_commit_is_refused(self) -> None:
        out = self.guard("prod_on_main", str(self.repo), self.dev_sha)
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("not on origin/main", out.stderr)

    def test_unknown_and_malformed_refs_are_refused(self) -> None:
        for bad in ("0" * 40, "origin/dev", "HEAD", "main; rm -rf /"):
            out = self.guard("prod_on_main", str(self.repo), bad)
            self.assertNotEqual(out.returncode, 0, bad)

    def test_dev_merged_into_main_becomes_deployable(self) -> None:
        origin = self.tmp / "origin.git"
        git(origin, "update-ref", "refs/heads/main", self.dev_sha)
        out = self.guard("prod_on_main", str(self.repo), self.dev_sha)
        self.assertEqual(out.returncode, 0, out.stderr)

    # --- CI log ----------------------------------------------------------------------
    def test_passing_ci_log_is_accepted(self) -> None:
        self.write_log(self.main_sha, f"PASS fake line before summary\n{SUMMARY}\nPASS  ruff\nPASS  pytest\n")
        self.assertEqual(self.guard("prod_ci_passed", str(self.logs), self.main_sha).returncode, 0)

    def test_missing_failing_or_faked_ci_log_is_refused(self) -> None:
        self.assertNotEqual(self.guard("prod_ci_passed", str(self.logs), self.main_sha).returncode, 0)
        self.write_log(self.main_sha, f"{SUMMARY}\nPASS  ruff\nFAIL  pytest (exit 1)\n")
        self.assertNotEqual(self.guard("prod_ci_passed", str(self.logs), self.main_sha).returncode, 0)
        # PASS lines only before the summary marker must not count.
        self.write_log(self.main_sha, "PASS  everything\n")
        self.assertNotEqual(self.guard("prod_ci_passed", str(self.logs), self.main_sha).returncode, 0)
        # A short sha is never accepted for the CI check.
        self.assertNotEqual(self.guard("prod_ci_passed", str(self.logs), self.main_sha[:12]).returncode, 0)

    # --- prod-release.sh -------------------------------------------------------------
    def release(self, *args: str) -> subprocess.CompletedProcess:
        env = dict(os.environ, PROD_REPO=str(self.repo), PROD_CI_LOG_DIR=str(self.logs),
                   PROD_ROOT=str(self.tmp / "prod"))
        return sh("bash", str(RELEASE), *args, env=env)

    def test_release_refuses_without_explicit_production_flag(self) -> None:
        out = self.release(self.main_sha)
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("--yes-production", out.stderr)
        out = self.release("--rollback")
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("--yes-production", out.stderr)

    def test_dry_run_refuses_dev_commit_and_accepts_main_with_ci(self) -> None:
        self.write_log(self.dev_sha, f"{SUMMARY}\nPASS  all\n")
        out = self.release(self.dev_sha, "--dry-run")
        self.assertNotEqual(out.returncode, 0)
        self.assertIn("not on origin/main", out.stderr)

        out = self.release(self.main_sha, "--dry-run")
        self.assertNotEqual(out.returncode, 0)  # on main, but no CI log yet
        self.assertIn("no ops/ci log", out.stderr)

        self.write_log(self.main_sha, f"{SUMMARY}\nPASS  all\n")
        out = self.release(self.main_sha, "--dry-run")
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("nothing was changed", out.stdout)
        self.assertFalse((self.tmp / "prod").exists(), "a dry run must not create anything")


if __name__ == "__main__":
    unittest.main()
