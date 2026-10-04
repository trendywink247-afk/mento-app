import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "transition", Path(__file__).resolve().parents[2] / "deploy/transition-preflight.py"
)
transition = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transition)


def expected():
    return dict(
        database_container="retained-db",
        container_id="a" * 64,
        database_name="mento",
        database_user="mento",
        system_identifier="123456",
        database_oid=16384,
        network="retained-network",
        network_id="b" * 64,
        volume="retained-volume",
        cache_container="retained-cache",
        cache_id="e" * 64,
        old_clients=["old-api"],
        other_clients=[],
    )


def candidate():
    services = {
        name: dict(profiles=["transition-unmanaged"])
        for name in ("postgres", "valkey", "glitchtip", "glitchtip-init-db")
    }
    for name in ("api_blue", "api_green", "worker", "migrate"):
        services[name] = dict(
            environment=dict(
                DATABASE_URL="postgresql+psycopg://mento:private-password@retained-db:5432/mento",
                REDIS_URL="redis://retained-cache:6379/0",
                UVICORN_WORKERS="2",
                DB_POOL_SIZE="5",
                DB_MAX_OVERFLOW="0",
            )
        )
    services["worker"]["command"] = ["python", "-m", "app.jobs.worker"]
    services["migrate"]["command"] = ["alembic", "upgrade", "head"]
    return dict(
        networks=dict(default=dict(external=True, name="retained-network")),
        services=services,
    )


def inventory():
    network = dict(NetworkID="b" * 64, Aliases=["retained-db", "postgres"])
    database = dict(
        Name="/retained-db",
        Id="a" * 64,
        Config=dict(Env=[]),
        Mounts=[
            dict(
                Destination="/var/lib/postgresql/data",
                Type="volume",
                Name="retained-volume",
            )
        ],
        NetworkSettings=dict(Networks={"retained-network": network}),
    )
    api = dict(
        Name="/old-api",
        Id="c" * 64,
        Config=dict(
            Env=[
                "DATABASE_URL=postgresql+psycopg://mento:private-password@postgres/mento"
            ]
        ),
        NetworkSettings=dict(
            Networks={"retained-network": dict(NetworkID="b" * 64, Aliases=["old-api"])}
        ),
    )
    cache = dict(
        Name="/retained-cache",
        Id="e" * 64,
        Config=dict(Env=[]),
        NetworkSettings=dict(
            Networks={
                "retained-network": dict(NetworkID="b" * 64, Aliases=["retained-cache"])
            }
        ),
    )
    return [database, api, cache]


class TransitionPreflightTests(unittest.TestCase):
    def mock_run(self, containers=None, identity="123456", limit=100, measured=None):
        measured = measured or dict(
            system_identifier=identity,
            database_oid=16384,
            processes=2,
            pool_size=5,
            max_overflow=5,
            queue_pool=0,
        )

        def invoke(args, **kwargs):
            if args[:3] == ["docker", "ps", "-q"]:
                return "synthetic-database\nsynthetic-api\n"
            if args[:2] == ["docker", "inspect"]:
                return json.dumps(containers or inventory())
            if "psql" in args:
                return f"{identity}\n16384\n{limit}\n3\n0\n"
            if args[:3] == ["docker", "exec", "-i"]:
                return json.dumps(measured)
            raise AssertionError("Unexpected command")

        return invoke

    def test_live_effective_old_and_new_overlap_counted(self):
        with patch.object(transition, "run", side_effect=self.mock_run()):
            live = transition.collect(expected())
        result = transition.validate_candidate(
            candidate(), expected(), live, headroom=5, other_connections=0
        )
        self.assertEqual(
            result["required"], 58
        )  # old API 20 + both new colors/worker/allowances 38
        self.assertEqual(
            result["server_limit"], 100
        )  # never substitutes desired Postgres 50

    def test_overlap_refused_at_actual_server_cap(self):
        with patch.object(transition, "run", side_effect=self.mock_run(limit=50)):
            live = transition.collect(expected())
        with self.assertRaises(ValueError):
            transition.validate_candidate(
                candidate(), expected(), live, headroom=5, other_connections=0
            )

    def test_wrong_new_or_cloned_database_and_network_refused(self):
        for change in ("container", "network", "volume", "cluster", "oid"):
            containers = inventory()
            identity, measured = "123456", None
            if change == "container":
                containers[0]["Id"] = "d" * 64
            if change == "network":
                containers[0]["NetworkSettings"]["Networks"]["retained-network"][
                    "NetworkID"
                ] = "d" * 64
            if change == "volume":
                containers[0]["Mounts"][0]["Name"] = "new-volume"
            if change == "cluster":
                identity = "999999"
            if change == "oid":
                measured = dict(
                    system_identifier="123456",
                    database_oid=99999,
                    processes=2,
                    pool_size=5,
                    max_overflow=5,
                    queue_pool=0,
                )
            with (
                self.subTest(change=change),
                patch.object(
                    transition,
                    "run",
                    side_effect=self.mock_run(containers, identity, measured=measured),
                ),
            ):
                with self.assertRaises(ValueError):
                    transition.collect(expected())

    def test_unlisted_clients_alias_collision_and_missing_baseline_fail_closed(self):
        for change in ("client", "alias", "missing"):
            containers = inventory()
            if change == "missing":
                containers.pop(1)
            else:
                extra = copy.deepcopy(containers[1])
                extra["Name"] = "/unlisted-api"
                if change == "alias":
                    extra["NetworkSettings"]["Networks"]["retained-network"][
                        "Aliases"
                    ] = ["postgres"]
                containers.append(extra)
            with (
                self.subTest(change=change),
                patch.object(transition, "run", side_effect=self.mock_run(containers)),
            ):
                with self.assertRaises(ValueError):
                    transition.collect(expected())

    def test_candidate_new_db_cache_and_unsafe_resolution_rejected(self):
        with patch.object(transition, "run", side_effect=self.mock_run()):
            live = transition.collect(expected())
        for change in (
            "newdb",
            "newcache",
            "profile",
            "dependency",
            "dns",
            "extra-host",
            "network",
            "unbudgeted-service",
            "links",
            "host-network",
        ):
            config = candidate()
            api = config["services"]["api_green"]
            if change == "newdb":
                api["environment"]["DATABASE_URL"] = (
                    "postgresql+psycopg://mento:private@postgres/mento"
                )
            if change == "newcache":
                api["environment"]["REDIS_URL"] = "redis://valkey:6379/0"
            if change == "profile":
                config["services"]["postgres"]["profiles"] = []
            if change == "dependency":
                api["depends_on"] = {"postgres": {}}
            if change == "dns":
                api["dns"] = ["1.1.1.1"]
            if change == "extra-host":
                api["extra_hosts"] = ["retained-db:127.0.0.1"]
            if change == "network":
                config["networks"]["default"]["external"] = False
            if change == "unbudgeted-service":
                config["services"]["extra-api"] = copy.deepcopy(api)
            if change == "links":
                api["links"] = ["other-db:retained-db"]
            if change == "host-network":
                api["network_mode"] = "host"
            with self.subTest(change=change), self.assertRaises(ValueError):
                transition.validate_candidate(
                    config, expected(), live, headroom=5, other_connections=0
                )

    def test_unbounded_live_pool_refused(self):
        bad = dict(
            system_identifier="123456",
            database_oid=16384,
            processes=2,
            pool_size=5,
            max_overflow=-1,
            queue_pool=0,
        )
        with (
            patch.object(transition, "run", side_effect=self.mock_run(measured=bad)),
            self.assertRaises(ValueError),
        ):
            transition.collect(expected())

    def test_old_worker_connector_also_counts_during_overlap(self):
        live = dict(
            pools=[
                dict(processes=2, pool_size=5, max_overflow=5, queue_pool=0),
                dict(processes=1, pool_size=5, max_overflow=5, queue_pool=4),
            ],
            max_connections=100,
            reserved=3,
        )
        result = transition.validate_candidate(
            candidate(), expected(), live, headroom=5, other_connections=0
        )
        self.assertEqual(result["required"], 72)
        live["max_connections"] = 71
        with self.assertRaises(ValueError):
            transition.validate_candidate(
                candidate(), expected(), live, headroom=5, other_connections=0
            )

    def test_changed_cache_refused(self):
        containers = inventory()
        containers[2]["Id"] = "f" * 64
        with (
            patch.object(transition, "run", side_effect=self.mock_run(containers)),
            self.assertRaises(ValueError),
        ):
            transition.collect(expected())

    def test_cli_failure_does_not_disclose_database_urls_or_stderr(self):
        output = io.StringIO()
        with (
            patch.object(
                transition.Path,
                "read_text",
                side_effect=[json.dumps(expected()), json.dumps(candidate())],
            ),
            patch.object(
                transition,
                "collect",
                side_effect=subprocess.CalledProcessError(
                    1, [], stderr="private-password"
                ),
            ),
            contextlib.redirect_stderr(output),
        ):
            status = transition.main(
                [
                    "--expected",
                    "synthetic",
                    "--candidate-config",
                    "synthetic",
                    "--headroom",
                    "5",
                    "--other-connections",
                    "0",
                ]
            )
        self.assertEqual(status, 1)
        self.assertNotIn("private-password", output.getvalue())
