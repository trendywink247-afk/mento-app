import contextlib
import copy
import io
import json
import unittest
from unittest.mock import patch

from effective_database_budget import main, rendered_budget


def topology():
    api = {"environment": {"UVICORN_WORKERS": "2", "DB_POOL_SIZE": "5",
                           "DB_MAX_OVERFLOW": "0"}}
    worker = copy.deepcopy(api)
    worker["command"] = ["python", "-m", "app.jobs.worker"]
    return {"services": {"api_blue": copy.deepcopy(api),
                         "api_green": copy.deepcopy(api), "worker": worker,
                         "postgres": {"command": ["postgres", "-c", "max_connections=50"]}}}


class EffectiveDatabaseBudgetTests(unittest.TestCase):
    def calculate(self, config=None, **overrides):
        args = dict(queue_pool=4, migration_connections=1, reserved=3,
                    headroom=5, other_connections=0)
        return rendered_budget(config or topology(), **(args | overrides))

    def test_two_processes_per_color_counted_and_worker_not_uvicorn(self):
        result = self.calculate()
        self.assertEqual(result["required"], 38)
        self.assertEqual(result["remaining"], 12)
        self.assertTrue(result["fits"])

    def test_other_clients_fill_remaining_capacity(self):
        self.assertTrue(self.calculate(other_connections=12)["fits"])
        self.assertFalse(self.calculate(other_connections=13)["fits"])

    def test_asymmetric_live_color_and_worker(self):
        config = topology()
        config["services"]["api_blue"]["environment"]["DB_MAX_OVERFLOW"] = "5"
        config["services"]["worker"]["environment"].update(
            DB_POOL_SIZE="2", DB_MAX_OVERFLOW="1")
        self.assertEqual(self.calculate(config, other_connections=4)["required"], 50)
        self.assertFalse(self.calculate(config, other_connections=5)["fits"])

    def test_first_rollout_with_old_worker_can_exceed_new_server_cap(self):
        config = topology()
        # Old blue and worker still use image-default 5+5 pools while the new
        # green color uses 5+0. Lowering Postgres to 50 in this overlap is unsafe.
        for name in ("api_blue", "worker"):
            config["services"][name]["environment"]["DB_MAX_OVERFLOW"] = "5"
        result = self.calculate(config)
        self.assertEqual(result["required"], 53)
        self.assertFalse(result["fits"])

    def test_replicas_multiply_processes_and_queue_connectors(self):
        config = topology()
        config["services"]["worker"]["deploy"] = {"replicas": 2}
        self.assertEqual(self.calculate(config)["required"], 47)
        config["services"]["api_green"]["scale"] = 2
        self.assertEqual(self.calculate(config)["required"], 57)
        self.assertFalse(self.calculate(config)["fits"])

    def test_missing_unbounded_or_invalid_pool_settings_fail_closed(self):
        for key, value in (("UVICORN_WORKERS", None), ("UVICORN_WORKERS", "0"),
                           ("DB_POOL_SIZE", "0"), ("DB_MAX_OVERFLOW", "-1"),
                           ("DB_POOL_SIZE", True), ("DB_POOL_SIZE", "secret")):
            with self.subTest(key=key, value=value):
                config = topology()
                env = config["services"]["api_blue"]["environment"]
                if value is None:
                    del env[key]
                else:
                    env[key] = value
                with self.assertRaises(ValueError):
                    self.calculate(config)

    def test_unknown_commands_and_conflicting_replica_counts_rejected(self):
        for changes in ({"command": ["custom-server"]}, {"entrypoint": ["custom"]},
                        {"scale": 2, "deploy": {"replicas": 3}}):
            config = topology()
            config["services"]["api_blue"].update(changes)
            with self.assertRaises(ValueError):
                self.calculate(config)
        config = topology()
        config["services"]["worker"]["command"] = ["custom-worker"]
        with self.assertRaises(ValueError):
            self.calculate(config)

    def test_missing_and_duplicate_server_limits_rejected(self):
        for command in (["postgres"], ["postgres", "max_connections=50", "max_connections=100"]):
            config = topology()
            config["services"]["postgres"]["command"] = command
            with self.assertRaises(ValueError):
                self.calculate(config)

    def test_cli_exit_codes_and_no_secrets_in_output(self):
        for other, expected in ((0, 0), (13, 1)):
            config = topology()
            config["services"]["api_blue"]["environment"]["DATABASE_URL"] = "private-value"
            output, errors = io.StringIO(), io.StringIO()
            with patch("sys.stdin", io.StringIO(json.dumps(config))), \
                    contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                status = main(["-", "--queue-pool", "4", "--migration-connections", "1",
                               "--reserved", "3", "--headroom", "5",
                               "--other-connections", str(other)])
            self.assertEqual(status, expected)
            self.assertNotIn("private-value", output.getvalue() + errors.getvalue())
        config["services"]["api_blue"]["environment"]["DB_POOL_SIZE"] = "private-value"
        output, errors = io.StringIO(), io.StringIO()
        with patch("sys.stdin", io.StringIO(json.dumps(config))), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            status = main(["-", "--queue-pool", "4", "--migration-connections", "1",
                           "--reserved", "3", "--headroom", "5", "--other-connections", "0"])
        self.assertEqual(status, 2)
        self.assertNotIn("private-value", output.getvalue() + errors.getvalue())
