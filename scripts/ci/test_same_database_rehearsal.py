"""Safety guards for disposable Docker rehearsal; no Docker or database required."""

import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "deploy/rehearse-same-database.py"


class RehearsalSafetyTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("rehearsal", SCRIPT)
        self.mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)

    def owned(self, ident="a" * 64, label=None, volume=False):
        labels = {"org.mento.local.rehearsal": label or self.mod.RUN}
        return {
            "Id": ident,
            "Config": {"Labels": labels},
            "Labels": labels,
            "CreatedAt": "2026-10-05T00:00:00Z",
        }

    def test_cleanup_removes_exact_id_after_ownership_check(self):
        ident = "a" * 64
        self.mod.created = [("container", "unique-name", ident)]
        with patch.object(
            self.mod, "docker", side_effect=[json.dumps([self.owned()]), "", "", "", ""]
        ) as call:
            self.assertTrue(self.mod.cleanup()[0]["removed"])
        self.assertEqual(call.call_args_list[1].args, ("container", "rm", "-f", ident))

    def test_changed_id_is_never_deleted(self):
        self.mod.created = [("container", "unique-name", "b" * 64)]
        with patch.object(
            self.mod, "docker", side_effect=[json.dumps([self.owned()]), "", "", ""]
        ) as call:
            self.assertFalse(self.mod.cleanup()[0]["removed"])
        self.assertFalse(any("rm" in row.args for row in call.call_args_list))

    def test_foreign_label_is_never_deleted(self):
        self.mod.created = [("container", "unique-name", "a" * 64)]
        with patch.object(
            self.mod,
            "docker",
            side_effect=[json.dumps([self.owned(label="foreign")]), "", "", ""],
        ) as call:
            self.assertFalse(self.mod.cleanup()[0]["removed"])
        self.assertFalse(any("rm" in row.args for row in call.call_args_list))

    def test_recreated_volume_is_never_deleted(self):
        self.mod.created = [("volume", "unique-volume", "old-creation-time")]
        with patch.object(
            self.mod,
            "docker",
            side_effect=[json.dumps([self.owned(volume=True)]), "", "", ""],
        ) as call:
            self.assertFalse(self.mod.cleanup()[0]["removed"])
        self.assertFalse(any("rm" in row.args for row in call.call_args_list))

    def test_creation_timeout_records_owned_identity_for_cleanup(self):
        with patch.object(
            self.mod,
            "docker",
            side_effect=[
                subprocess.TimeoutExpired("docker", 90),
                json.dumps([self.owned()]),
            ],
        ):
            with self.assertRaises(subprocess.TimeoutExpired):
                self.mod.create("container", "unique-name", ["run"])
        self.assertEqual(self.mod.created, [("container", "unique-name", "a" * 64)])

    def test_creation_failure_never_claims_foreign_resource(self):
        with patch.object(
            self.mod,
            "docker",
            side_effect=[RuntimeError(), json.dumps([self.owned(label="foreign")])],
        ):
            with self.assertRaises(ValueError):
                self.mod.create("container", "unique-name", ["run"])
        self.assertEqual(self.mod.created, [])

    def test_leftover_resources_fail_cleanup(self):
        with patch.object(self.mod, "docker", return_value="unexpected-owned-resource"):
            with self.assertRaises(RuntimeError):
                self.mod.cleanup()

    def test_daemon_failure_cannot_claim_cleanup_success(self):
        with patch.object(
            self.mod, "docker", side_effect=RuntimeError("daemon unavailable")
        ):
            with self.assertRaises(RuntimeError):
                self.mod.cleanup()

    def test_wrong_revision_refused_before_network_creation(self):
        self.mod.IMAGE, self.mod.REVISION = "candidate", "a" * 40
        image = {
            "Id": "sha256:accepted",
            "Config": {"Labels": {"org.opencontainers.image.revision": "b" * 40}},
        }
        with patch.object(self.mod, "docker", return_value=json.dumps([image])) as call:
            with self.assertRaises(ValueError):
                self.mod.main()
        self.assertEqual(call.call_count, 1)
        self.assertEqual(self.mod.created, [])

    def test_run_pins_image_id_and_only_loopback_port(self):
        with patch.object(
            self.mod, "docker", return_value=json.dumps([{"Id": "sha256:immutable"}])
        ), patch.object(self.mod, "create", return_value="a" * 64) as create:
            self.mod.container("unique-name", "mutable:tag", port=True)
        command = create.call_args.args[2]
        self.assertEqual(command[-1], "sha256:immutable")
        self.assertIn("127.0.0.1::8000", command)
        self.assertNotIn("--privileged", command)

    def test_remote_context_refused_before_creation(self):
        with patch.object(
            self.mod,
            "docker",
            return_value=json.dumps(
                [{"Endpoints": {"docker": {"Host": "ssh://production"}}}]
            ),
        ):
            with self.assertRaises(SystemExit):
                self.mod.cli(
                    [
                        "--image",
                        "candidate",
                        "--revision",
                        "a" * 40,
                        "--context",
                        "remote",
                    ]
                )
        self.assertEqual(self.mod.created, [])

    def test_preflight_uses_pinned_context_adapter(self):
        with patch.object(self.mod, "docker", return_value="probe") as call:
            self.assertEqual(
                self.mod.run_preflight(
                    ["docker", "exec", "id", "python", "-"], input="safe probe"
                ),
                "probe",
            )
        call.assert_called_once_with(
            "exec", "id", "python", "-", input="safe probe", timeout=30
        )
        with self.assertRaises(ValueError):
            self.mod.run_preflight(["ssh", "production"])

    def test_docker_always_explicitly_pins_validated_context(self):
        self.mod.CONTEXT = "local-context"
        result = subprocess.CompletedProcess([], 0, "ok", "")
        with patch.object(self.mod.subprocess, "run", return_value=result) as call:
            self.mod.docker("ps")
        self.assertEqual(
            call.call_args.args[0], ["docker", "--context", "local-context", "ps"]
        )


if __name__ == "__main__":
    unittest.main()
