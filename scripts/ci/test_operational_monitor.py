import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


def module(filename):
    spec = importlib.util.spec_from_file_location(filename, Path(__file__).resolve().parents[2] / "deploy" / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


classifier = module("classify-operational-health.py")
probe = module("operational-monitor-probe.py")


class OperationalMonitorTests(unittest.TestCase):
    def setUp(self):
        self.payload = dict(version=1, observed_at=1000, host_available=True,
                            memory_available_mib=256, disk_free_mib=2048, load_per_cpu=0.5,
                            queue=dict(available=True, worker_alive=True, oldest_queued_seconds=None, failed_24h=0),
                            backup=dict(version=1, completed_at=900, archive_sha256="a" * 64))

    def test_healthy(self):
        self.assertTrue(all(classifier.checks(self.payload, now=1000).values()))

    def test_missing_stale_future_and_invalid_evidence(self):
        for value in (None, [], {}, dict(version=True), dict(self.payload, observed_at=0),
                      dict(self.payload, observed_at=1001), dict(self.payload, observed_at=True)):
            with self.subTest(value=value):
                self.assertFalse(any(classifier.checks(value, now=1000).values()))

    def test_host_thresholds_and_strict_numbers(self):
        for key, value in (("memory_available_mib", 127), ("disk_free_mib", 1023),
                           ("load_per_cpu", 2.1), ("load_per_cpu", float("nan")),
                           ("load_per_cpu", 10 ** 1000),
                           ("memory_available_mib", True), ("host_available", "true")):
            with self.subTest(key=key, value=value):
                self.assertFalse(classifier.checks(dict(self.payload, **{key: value}), now=1000)["host"])

    def test_dead_worker_unavailable_queue_and_failed_backlog(self):
        for key, value, failure in (("worker_alive", False, "worker"), ("available", False, "worker"),
                                    ("worker_alive", "true", "worker"), ("failed_24h", 1, "backlog"),
                                    ("failed_24h", True, "backlog"), ("oldest_queued_seconds", 301, "backlog"),
                                    ("oldest_queued_seconds", -1, "backlog")):
            item = copy.deepcopy(self.payload)
            item["queue"][key] = value
            self.assertFalse(classifier.checks(item, now=1000)[failure])

    def test_backup_requires_verified_completion_digest_not_mtime(self):
        for backup in (None, {}, dict(mtime=999), dict(version=1, completed_at=999),
                       dict(version=1, completed_at=30001, archive_sha256="a" * 64),
                       dict(version=1, completed_at=0, archive_sha256="a" * 64),
                       dict(version=True, completed_at=29999, archive_sha256="a" * 64),
                       dict(version=1, completed_at=29999, archive_sha256="not-a-hash")):
            self.assertFalse(classifier.checks(dict(self.payload, observed_at=30000, backup=backup), now=30000)["backup"])
        healthy = dict(version=1, completed_at=29999, archive_sha256="a" * 64)
        self.assertTrue(classifier.checks(dict(self.payload, observed_at=30000, backup=healthy), now=30000)["backup"])

    def test_collector_failures_are_private_and_fail_closed(self):
        with patch.object(probe.Path, "read_text", side_effect=OSError("private path")), \
             patch.object(probe.subprocess, "run", side_effect=OSError("private detail")), \
             patch.dict(probe.os.environ, {}, clear=True):
            result = probe.collect()
        self.assertFalse(result["host_available"])
        self.assertFalse(result["queue"]["available"])
        self.assertIsNone(result["backup"])
        self.assertNotIn("private", str(result))

    def test_latest_failed_attempt_overrides_fresh_success_archive(self):
        for attempt in (None, {}, dict(version=1, status="failed", attempted_at=999),
                        dict(version=1, status="success", attempted_at=1001),
                        dict(version=1, status="success", attempted_at=True),
                        dict(version=True, status="success", attempted_at=999)):
            self.assertFalse(classifier.checks(dict(self.payload, backup_result=attempt), now=1000)["backup"])
        attempt = dict(version=1, status="success", attempted_at=999)
        self.assertTrue(classifier.checks(dict(self.payload, backup_result=attempt), now=1000)["backup"])

    def test_configured_missing_attempt_marker_fails_closed(self):
        with patch.dict(probe.os.environ, {"MONITOR_BACKUP_RESULT": "/missing/synthetic-result"}), \
             patch.object(probe.subprocess, "run", side_effect=OSError("private")):
            result = probe.collect()
        self.assertIn("backup_result", result)
        self.assertIsNone(result["backup_result"])

    def test_invalid_container_does_not_execute_docker(self):
        with patch.dict(probe.os.environ, {"MONITOR_WORKER_CONTAINER": "--privileged"}), \
             patch.object(probe.subprocess, "run") as command:
            result = probe.collect()
        command.assert_not_called()
        self.assertFalse(result["queue"]["available"])
