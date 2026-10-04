from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from test_transition_preflight import candidate, expected


def load(filename):
    spec = importlib.util.spec_from_file_location(
        filename, Path(__file__).resolve().parents[2] / "deploy" / filename
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


preparation = load("prepare-transition.py")
runtime = load("verify-transition-runtime.py")


def release():
    return dict(sha="f" * 40, runtime_image_id="sha256:" + "d" * 64)


class PreparationTests(unittest.TestCase):
    def test_preflight_collects_inside_same_deployment_lock_and_plan_never_activates(
        self,
    ):
        events = []

        @contextmanager
        def locked(_directory):
            events.append("locked")
            yield
            events.append("unlocked")

        def live(_expected):
            self.assertEqual(events[-1], "locked")
            events.append("inspected")
            return dict(
                pools=[dict(processes=2, pool_size=5, max_overflow=5, queue_pool=0)],
                max_connections=100,
                reserved=3,
            )

        config = candidate()
        for name in ("api_blue", "api_green", "worker", "migrate"):
            config["services"][name]["image"] = "mento-api:" + "f" * 12
        with (
            patch.object(preparation, "deploy_lock", locked),
            patch.object(
                preparation, "release_identity", return_value="mento-api:" + "f" * 12
            ),
            patch.object(preparation.preflight, "collect", side_effect=live),
            patch.object(preparation.preflight, "run") as subprocess,
        ):
            plan = preparation.prepare(
                expected(),
                config,
                release(),
                "synthetic",
                headroom=5,
                other_connections=0,
            )
        self.assertEqual(events, ["locked", "inspected", "unlocked"])
        subprocess.assert_not_called()
        self.assertFalse(plan["activation_authorized"])
        self.assertEqual(plan["budget"]["required"], 58)
        self.assertNotIn("private-password", json.dumps(plan))

    def test_exact_loaded_image_label_and_runtime_id_required(self):
        correct = dict(
            Id=release()["runtime_image_id"],
            Config=dict(Labels={"org.opencontainers.image.revision": "f" * 40}),
        )
        for image in (
            dict(correct, Id="sha256:" + "e" * 64),
            dict(correct, Config=dict(Labels={})),
            correct,
        ):
            with patch.object(
                preparation.preflight, "run", return_value=json.dumps([image])
            ):
                if image == correct:
                    self.assertEqual(
                        preparation.release_identity(release()), "mento-api:" + "f" * 12
                    )
                else:
                    with self.assertRaises(ValueError):
                        preparation.release_identity(release())

    @unittest.skipIf(os.name != "posix", "Real deployment flock is Linux acceptance")
    def test_real_shared_lock_refuses_contender_then_releases(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory, 0o700)
            with preparation.deploy_lock(directory):
                with self.assertRaises(BlockingIOError):
                    with preparation.deploy_lock(directory):
                        self.fail("contending preparation ran")
            with preparation.deploy_lock(directory):
                pass

    @unittest.skipIf(os.name != "posix", "Linux ownership/symlink checks")
    def test_unsafe_lock_symlink_and_writable_state_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory, 0o777)
            with self.assertRaises(ValueError):
                with preparation.deploy_lock(directory):
                    pass
            os.chmod(directory, 0o700)
            target = Path(directory) / "unrelated"
            target.write_text("unchanged")
            (Path(directory) / "deploy.lock").symlink_to(target)
            with self.assertRaises(OSError):
                with preparation.deploy_lock(directory):
                    pass
            self.assertEqual(target.read_text(), "unchanged")


class RuntimeVerificationTests(unittest.TestCase):
    def run_fake(self, args, **kwargs):
        name = args[2] if args[:2] == ["docker", "inspect"] else args[3]
        if args[:2] == ["docker", "inspect"]:
            return json.dumps(
                [
                    dict(
                        Image=self.image,
                        State=dict(Running=True, Health=dict(Status=self.api_health)),
                    )
                ]
            )
        if kwargs.get("input") == runtime.HEARTBEAT:
            return json.dumps(dict(available=True, worker_alive=self.worker_alive))
        return json.dumps(
            dict(
                system_identifier=self.identity,
                database_oid=16384,
                queue_pool=4 if name == "new-worker" else 0,
            )
        )

    def setUp(self):
        self.image = release()["runtime_image_id"]
        self.api_health = "healthy"
        self.worker_alive = True
        self.identity = "123456"
        self.pools = [dict(processes=2, queue_pool=0), dict(processes=1, queue_pool=4)]

    def invoke(self):
        with (
            patch.object(runtime.preparation, "release_identity"),
            patch.object(
                runtime.preflight, "collect", return_value=dict(pools=self.pools)
            ),
            patch.object(runtime.preflight, "run", side_effect=self.run_fake),
        ):
            return runtime.verify(
                expected(), release(), dict(api_green="new-api", worker="new-worker")
            )

    def test_topology_uses_explicit_colors_and_requires_worker(self):
        result = self.invoke()
        self.assertEqual(result["api_colors"], ["api_green"])
        self.assertFalse(result["production_acceptance"])
        for roles in (
            {"api": "new-api", "worker": "new-worker"},
            {"api_blue": "new-api"},
            {"api_blue": "same", "worker": "same"},
        ):
            with self.assertRaises(ValueError):
                runtime.verify(expected(), release(), roles)

    def test_wrong_image_database_unhealthy_api_stale_worker_and_double_scheduler_refused(
        self,
    ):
        for field, bad in (
            ("image", "sha256:" + "e" * 64),
            ("identity", "999999"),
            ("api_health", "starting"),
            ("worker_alive", False),
        ):
            original = getattr(self, field)
            setattr(self, field, bad)
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.invoke()
            setattr(self, field, original)
        self.pools.append(dict(processes=1, queue_pool=4))
        with self.assertRaises(ValueError):
            self.invoke()
