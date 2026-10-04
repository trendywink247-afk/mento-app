"""Pure safety tests: no Docker commands, database, network or real keys."""

import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "primary_loss_rehearsal", ROOT / "deploy/rehearse-primary-loss.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
RUN = "mento-primary-loss-" + "a" * 32


class Daemon:
    def __init__(self):
        self.objects = {}
        self.deletions = []
        self.fail_after_create = False
        self.fail_volume_delete = False
        self.fail_list = False

    def __call__(self, *args):
        kind = "container" if args[0] == "run" else args[0]
        if args[0] == "run" or args[1] == "create":
            name = args[args.index("--name") + 1] if args[0] == "run" else args[-1]
            labels = dict(
                args[i + 1].split("=", 1) for i, value in enumerate(args) if value == "--label"
            )
            info = {
                "Name": name,
                "Id": "identity-" + name,
                "CreatedAt": "original-created-time",
                "Labels": labels,
                "Config": {"Labels": labels},
                "HostConfig": {"PortBindings": None},
            }
            self.objects[kind, name] = info
            if self.fail_after_create:
                raise RuntimeError("Timed out after daemon created resource")
            return name
        if args[1] == "inspect":
            return json.dumps([self.objects[kind, args[2]]])
        if args[1] == "rm":
            name = args[-1]
            if kind == "volume" and self.fail_volume_delete:
                raise RuntimeError("volume is still in use")
            key = next(
                key
                for key, info in self.objects.items()
                if key[0] == kind and (key[1] == name or info["Id"] == name)
            )
            self.deletions.append(key)
            del self.objects[key]
            return ""
        if args[1] == "ls":
            if self.fail_list:
                raise RuntimeError("Daemon unavailable")
            return "\n".join(
                name for candidate_kind, name in self.objects if candidate_kind == kind
            )
        raise AssertionError("Unexpected fake daemon command")


class SafetyTest(unittest.TestCase):
    def setUp(self):
        self.daemon = Daemon()
        self.resources = module.Resources(RUN, self.daemon)

    def source(self):
        source, volume = RUN + "-source", RUN + "-source-data"
        self.resources.create("volume", volume, ["volume", "create"])
        self.resources.register_container(source, ["image"])
        return source, volume

    def test_source_loss_requires_both_resources_removed_in_order(self):
        source, volume = self.source()
        module.require_source_loss(self.resources, source, volume)
        self.assertEqual(self.daemon.deletions, [("container", source), ("volume", volume)])
        self.assertEqual(self.resources.owned, [])

    def test_in_use_volume_prevents_claiming_source_loss(self):
        source, volume = self.source()
        self.daemon.fail_volume_delete = True
        with self.assertRaises(RuntimeError):
            module.require_source_loss(self.resources, source, volume)
        self.assertIn(("volume", volume), self.daemon.objects)

    def test_replaced_container_or_changed_label_is_never_deleted(self):
        source, _volume = self.source()
        original = self.daemon.objects["container", source]
        for field, value in [("Id", "replacement-id"), ("Labels", {})]:
            with self.subTest(field=field):
                copied = json.loads(json.dumps(original))
                if field == "Labels":
                    copied["Config"]["Labels"] = value
                else:
                    copied[field] = value
                self.daemon.objects["container", source] = copied
                with self.assertRaises(ValueError):
                    self.resources.remove("container", source)
                self.assertEqual(self.daemon.deletions, [])

    def test_replaced_volume_identity_is_never_deleted(self):
        _source, volume = self.source()
        self.daemon.objects["volume", volume]["CreatedAt"] = "replacement-created-time"
        with self.assertRaises(ValueError):
            self.resources.remove("volume", volume)
        self.assertEqual(self.daemon.deletions, [])

    def test_timeout_after_create_keeps_owned_resource_for_cleanup(self):
        name = RUN + "-volume"
        self.daemon.fail_after_create = True
        with self.assertRaises(RuntimeError):
            self.resources.create("volume", name, ["volume", "create"])
        self.assertEqual(len(self.resources.owned), 1)
        self.daemon.fail_after_create = False
        self.resources.cleanup()
        self.assertEqual(self.daemon.objects, {})

    def test_no_existing_names_or_unavailable_daemon_acceptance(self):
        with self.assertRaises(ValueError):
            self.resources.create("volume", "mento-h-dev-postgres-1", ["volume", "create"])
        self.assertEqual(self.daemon.objects, {})
        self.daemon.fail_list = True
        with self.assertRaises(RuntimeError):
            self.resources.cleanup()

    def test_remote_daemon_targets_fail_closed(self):
        for host in [
            "ssh://example",
            "tcp://127.0.0.1:2375",
            "https://example",
            "npipe:////remote/pipe/docker",
            None,
        ]:
            with self.subTest(host=host), self.assertRaises(ValueError):
                module.require_local_docker_host(host)
        module.require_local_docker_host("unix:///var/run/docker.sock")
        module.require_local_docker_host("npipe:////./pipe/dockerDesktopLinuxEngine")

    def test_optimized_python_refused_before_docker_or_fixtures(self):
        for name in ["rehearse-primary-loss.py", "primary-loss-fixture.py"]:
            result = subprocess.run(
                [sys.executable, "-O", str(ROOT / "deploy" / name), "--help"], capture_output=True
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"assertions enabled", result.stderr)

    def test_private_cleanup_resolves_exact_temporary_boundary(self):
        temporary = ROOT / ".local/tmp"
        temporary.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="primary-loss-", dir=temporary) as directory:
            with patch.object(module.shutil, "rmtree") as remove:
                module.cleanup_private_work(Path(directory))
                remove.assert_called_once_with(Path(directory))
        with patch.object(module.shutil, "rmtree") as remove:
            with self.assertRaises(ValueError):
                module.cleanup_private_work(ROOT)
            remove.assert_not_called()


if __name__ == "__main__":
    unittest.main()
