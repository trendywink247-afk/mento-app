"""Cycle control-flow tests; crypto/transport have separate real-tool drills."""

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "backup_cycle",
    Path(__file__).resolve().parents[2] / "deploy/run-encrypted-backup.py",
)
cycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cycle)


@unittest.skipUnless(os.name == "posix", "Linux flock and directory fsync required")
class BackupCycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.directory.chmod(0o700)
        self.recipient = self.directory / "recipient.txt"
        self.recipient.write_text("synthetic public recipient")
        self.commands = []

    def fake(self, command, **kwargs):
        self.commands.append(command)
        self.assertTrue(kwargs["check"])
        self.assertLessEqual(kwargs["timeout"], 900)
        if command[1].endswith("create-encrypted-recovery.sh"):
            Path(command[-1]).write_bytes(b"synthetic encrypted bytes")
        return subprocess.CompletedProcess(command, 0)

    def run_cycle(self):
        cycle.cycle(
            "synthetic-container",
            "synthetic-user",
            "synthetic-db",
            self.recipient,
            self.directory,
            ":local:synthetic-destination",
        )

    def test_success_only_after_verified_copy(self):
        with patch.object(cycle.subprocess, "run", side_effect=self.fake):
            self.run_cycle()
        self.assertEqual(len(self.commands), 2)
        marker = json.loads((self.directory / "backup-success.json").read_text())
        self.assertEqual(
            marker["archive_sha256"],
            hashlib.sha256(b"synthetic encrypted bytes").hexdigest(),
        )
        self.assertEqual(
            json.loads((self.directory / "backup-result.json").read_text())["status"],
            "success",
        )
        self.assertEqual(
            (self.directory / "backup-success.json").stat().st_mode & 0o777, 0o600
        )
        self.assertEqual(list(self.directory.glob(".backup-status-*")), [])

    def test_copy_failure_preserves_prior_success_and_new_archive(self):
        previous = b"previous verified marker"
        (self.directory / "backup-success.json").write_bytes(previous)

        def failure(command, **kwargs):
            self.fake(command, **kwargs)
            if command[1].endswith("copy-encrypted-recovery.sh"):
                raise subprocess.CalledProcessError(1, command)

        with patch.object(cycle.subprocess, "run", side_effect=failure):
            with self.assertRaises(subprocess.CalledProcessError):
                self.run_cycle()
        self.assertEqual(
            (self.directory / "backup-success.json").read_bytes(), previous
        )
        self.assertEqual(
            json.loads((self.directory / "backup-result.json").read_text())["status"],
            "failed",
        )
        self.assertEqual(len(list(self.directory.glob("*.age"))), 1)

    def test_creation_failure_never_copies_or_claims_success(self):
        with patch.object(
            cycle.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired("synthetic", 900),
        ) as run:
            with self.assertRaises(subprocess.TimeoutExpired):
                self.run_cycle()
        self.assertEqual(run.call_count, 1)
        self.assertFalse((self.directory / "backup-success.json").exists())
        self.assertEqual(
            json.loads((self.directory / "backup-result.json").read_text())["status"],
            "failed",
        )

    def test_lock_covers_whole_cycle_without_clobbering_active_status(self):
        import fcntl

        with (self.directory / ".backup-cycle.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(cycle.subprocess, "run") as run:
                with self.assertRaises(BlockingIOError):
                    self.run_cycle()
                run.assert_not_called()
        self.assertFalse((self.directory / "backup-result.json").exists())

    def test_nonprivate_directory_refused_before_work(self):
        self.directory.chmod(0o755)
        with patch.object(cycle.subprocess, "run") as run:
            with self.assertRaises(ValueError):
                self.run_cycle()
            run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
