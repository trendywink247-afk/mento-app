#!/usr/bin/env python3
"""Unit tests for ops/compare-compose.py; also checks the two real compose files in git.

    python3 ops/test-compare-compose.py
"""

import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("cc", HERE / "compare-compose.py")
cc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cc)


def stack(**over):
    base = {
        "services": {
            "api": {"container_name": "mento-api-prod", "image": "mento-api:92b8f57a5cd3",
                    "ports": [{"host_ip": "127.0.0.1", "published": "8000", "target": 8000}]},
            "postgres": {"container_name": "mento-postgres-prod", "image": "postgres:16-alpine",
                         "volumes": [{"source": "mento_pgdata_prod", "target": "/var/lib/postgresql/data"}]},
            "redis": {"container_name": "mento-redis-prod", "image": "redis:7-alpine",
                      "volumes": [{"source": "mento_redisdata_prod", "target": "/data"}]},
        },
        "volumes": {"mento_pgdata_prod": {}, "mento_redisdata_prod": {}},
    }
    for path, value in over.items():
        node = base
        keys = path.split("__")
        for k in keys[:-1]:
            node = node[k]
        node[keys[-1]] = value
    return base


class Compare(unittest.TestCase):
    def test_identical_stacks_match(self):
        self.assertEqual(cc.compare(stack(), stack(), "mento-api:92b8f57a5cd3"), [])

    def test_container_name_difference_is_reported(self):
        new = stack(services__api__container_name="mento-api")
        self.assertTrue(any("container_name" in p for p in cc.compare(stack(), new)))

    def test_missing_service_is_reported(self):
        new = stack()
        del new["services"]["redis"]
        self.assertTrue(any("'redis' missing from the NEW" in p for p in cc.compare(stack(), new)))

    def test_renamed_service_is_reported(self):
        new = stack()
        new["services"]["db"] = new["services"].pop("postgres")
        self.assertTrue(any("'postgres' missing from the NEW" in p for p in cc.compare(stack(), new)))

    def test_postgres_volume_difference_is_reported(self):
        new = stack(services__postgres__volumes=[{"source": "other", "target": "/var/lib/postgresql/data"}])
        self.assertTrue(any("postgres: volumes differ" in p for p in cc.compare(stack(), new)))

    def test_named_volume_difference_is_reported(self):
        new = stack(volumes={"mento_pgdata_prod": {}})
        self.assertTrue(any("named volumes differ" in p for p in cc.compare(stack(), new)))

    def test_api_port_difference_is_reported(self):
        new = stack(services__api__ports=[{"host_ip": "127.0.0.1", "published": "18010", "target": 8000}])
        self.assertTrue(any("api: ports differ" in p for p in cc.compare(stack(), new)))

    def test_old_image_expectation(self):
        self.assertTrue(any("expected" in p for p in cc.compare(stack(), stack(), "mento-api:latest")))

    def test_short_and_long_syntax_compare_equal(self):
        short = stack(services__api__ports=["127.0.0.1:8000:8000"])
        self.assertEqual(cc.compare(short, stack()), [])

    def test_cli_exit_codes_and_no_env_in_output(self):
        secret = "S3CR3T-VALUE"
        old = stack()
        old["services"]["api"]["environment"] = {"JWT_SECRET": secret}
        with tempfile.TemporaryDirectory() as d:
            a, b = pathlib.Path(d, "a.json"), pathlib.Path(d, "b.json")
            a.write_text(json.dumps(old))
            b.write_text(json.dumps(stack()))
            ok = subprocess.run([sys.executable, str(HERE / "compare-compose.py"), str(a), str(b)],
                                capture_output=True, text=True)
            self.assertEqual(ok.returncode, 0, ok.stdout + ok.stderr)
            self.assertNotIn(secret, ok.stdout + ok.stderr)
            b.write_text(json.dumps(stack(services__redis__container_name="x")))
            bad = subprocess.run([sys.executable, str(HERE / "compare-compose.py"), str(a), str(b)],
                                 capture_output=True, text=True)
            self.assertEqual(bad.returncode, 1)
            self.assertIn("MISMATCH", bad.stdout)


class RealFiles(unittest.TestCase):
    """The two compose files committed in this repo must agree on the adopted containers."""

    def test_old_and_cutover_compose_match(self):
        try:
            import yaml
        except ImportError:
            self.skipTest("PyYAML not installed")
        root = HERE.parent / "deploy"
        old = yaml.safe_load((root / "docker-compose.prod.yml").read_text())
        new = yaml.safe_load((root / "compose.prod-cutover.yml").read_text())
        # The old file builds/tags its own api image from API_TAG; compare the rest.
        problems = cc.compare(old, new)
        self.assertEqual(problems, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
