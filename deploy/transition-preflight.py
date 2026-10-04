"""Read-only same-database transition guard. Never print configs or credentials.

Run on the target host against protected rendered Compose and expected-identity
JSON. This is planning evidence, not authorization to deploy or change a database.
"""

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/ci"))
from database_budget import aggregate_budget
from effective_database_budget import integer, replicas


def run(args, **kwargs):
    return subprocess.run(
        args, capture_output=True, text=True, timeout=30, check=True, **kwargs
    ).stdout


def env(container):
    return dict(
        item.split("=", 1) for item in container["Config"].get("Env", []) if "=" in item
    )


def expected_shape(expected):
    for key in (
        "database_container",
        "database_name",
        "database_user",
        "network",
        "volume",
        "cache_container",
    ):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", expected[key]):
            raise ValueError("Invalid identity")
    for key in ("container_id", "network_id", "cache_id"):
        if not re.fullmatch(r"[0-9a-f]{64}", expected[key]):
            raise ValueError("Invalid identity")
    if not re.fullmatch(r"[0-9]+", expected["system_identifier"]):
        raise ValueError("Invalid identity")
    if type(expected["database_oid"]) is not int or expected["database_oid"] <= 0:
        raise ValueError("Invalid identity")
    for key in ("old_clients", "other_clients"):
        if not isinstance(expected[key], list) or any(
            not isinstance(v, str) for v in expected[key]
        ):
            raise ValueError("Invalid client inventory")
        if len(set(expected[key])) != len(expected[key]):
            raise ValueError("Duplicate client inventory")
    if set(expected["old_clients"]) & set(expected["other_clients"]):
        raise ValueError("Conflicting client inventory")
    if not expected["old_clients"]:
        raise ValueError("Serving baseline inventory required")
    if expected["database_container"] == expected["cache_container"]:
        raise ValueError("Distinct database and cache required")


POOL_PROBE = """
import ast, inspect, json
from pathlib import Path
from sqlalchemy import text
from app.db import engine
args = Path('/proc/1/cmdline').read_bytes().decode().split('\\0')
queue = 0
if 'app.jobs.worker' in args:
    from app.jobs import worker
    bounds = [kw.value.value for node in ast.walk(ast.parse(inspect.getsource(worker)))
              if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
              and node.func.id == 'PsycopgConnector' for kw in node.keywords
              if kw.arg == 'max_size' and isinstance(kw.value, ast.Constant)]
    assert len(bounds) == 1 and type(bounds[0]) is int and bounds[0] > 0
    queue = bounds[0]
    processes = 1
else:
    assert any('uvicorn' in arg for arg in args) and '--workers' in args
    processes = int(args[args.index('--workers')+1])
with engine.connect() as db:
    identity = db.execute(text('SELECT system_identifier::text FROM pg_control_system()')).scalar_one()
    oid = db.execute(text('SELECT oid FROM pg_database WHERE datname = current_database()')).scalar_one()
print(json.dumps(dict(system_identifier=identity, database_oid=oid, processes=processes,
                     pool_size=engine.pool.size(), max_overflow=engine.pool._max_overflow, queue_pool=queue)))
"""


def collect(expected):
    expected_shape(expected)
    ids = run(["docker", "ps", "-q"]).split()
    if not ids:
        raise ValueError("No serving baseline")
    containers = json.loads(run(["docker", "inspect", *ids]))
    by_name = {item["Name"].lstrip("/"): item for item in containers}
    database = by_name[expected["database_container"]]
    if database["Id"] != expected["container_id"]:
        raise ValueError("Database container changed")
    networks = database["NetworkSettings"]["Networks"]
    if networks[expected["network"]]["NetworkID"] != expected["network_id"]:
        raise ValueError("Database network changed")
    cache = by_name[expected["cache_container"]]
    if (
        cache["Id"] != expected["cache_id"]
        or cache["NetworkSettings"]["Networks"][expected["network"]]["NetworkID"]
        != expected["network_id"]
    ):
        raise ValueError("Cache identity or network changed")
    mounts = [
        v for v in database["Mounts"] if v["Destination"] == "/var/lib/postgresql/data"
    ]
    if (
        len(mounts) != 1
        or mounts[0].get("Type") != "volume"
        or mounts[0].get("Name") != expected["volume"]
    ):
        raise ValueError("Database volume changed")
    sql = (
        "SELECT system_identifier::text FROM pg_control_system(); "
        "SELECT oid FROM pg_database WHERE datname=current_database(); "
        "SHOW max_connections; SHOW superuser_reserved_connections; SHOW reserved_connections;"
    )
    rows = run(
        [
            "docker",
            "exec",
            database["Id"],
            "psql",
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-At",
            "-U",
            expected["database_user"],
            "-d",
            expected["database_name"],
            "-c",
            sql,
        ]
    ).splitlines()
    if (
        len(rows) != 5
        or rows[0] != expected["system_identifier"]
        or integer(rows[1]) != expected["database_oid"]
    ):
        raise ValueError("Database cluster changed")
    aliases = set(networks[expected["network"]].get("Aliases") or []) | {
        expected["database_container"]
    }
    clients = set()
    for name, container in by_name.items():
        network = container["NetworkSettings"]["Networks"].get(expected["network"], {})
        if network.get("NetworkID") != expected["network_id"]:
            continue
        if name != expected["cache_container"] and expected["cache_container"] in set(
            network.get("Aliases") or []
        ):
            raise ValueError("Cache DNS alias collision")
        if name != expected["database_container"] and aliases & set(
            network.get("Aliases") or []
        ):
            raise ValueError("Database DNS alias collision")
        url = env(container).get("DATABASE_URL")
        if url and urlsplit(url).hostname in aliases:
            clients.add(name)
    if clients != set(expected["old_clients"]) | set(expected["other_clients"]):
        raise ValueError("Database client inventory changed or incomplete")
    pools = []
    for name in expected["old_clients"]:
        measured = json.loads(
            run(
                ["docker", "exec", "-i", by_name[name]["Id"], "python", "-"],
                input=POOL_PROBE,
            )
        )
        if (
            measured.pop("system_identifier") != expected["system_identifier"]
            or measured.pop("database_oid") != expected["database_oid"]
        ):
            raise ValueError("Serving client uses another database")
        if integer(measured["processes"]) < 1:
            raise ValueError("Unknown serving process count")
        pools.append({k: integer(v) for k, v in measured.items()})
    return dict(
        pools=pools,
        max_connections=integer(rows[2]),
        reserved=integer(rows[3]) + integer(rows[4]),
    )


def validate_candidate(config, expected, live, *, headroom, other_connections):
    expected_shape(expected)
    network = config["networks"]["default"]
    if (
        network.get("external") is not True
        or network.get("name") != expected["network"]
    ):
        raise ValueError("Candidate network is not authoritative")
    services = config["services"]
    if set(services) - {
        "api_blue",
        "api_green",
        "worker",
        "migrate",
        "caddy",
        "postgres",
        "valkey",
        "glitchtip",
        "glitchtip-init-db",
    }:
        raise ValueError("Unbudgeted candidate services")
    for name in ("postgres", "valkey", "glitchtip", "glitchtip-init-db"):
        if name in services and services[name].get("profiles") != [
            "transition-unmanaged"
        ]:
            raise ValueError("Independent data services must be excluded")
    pools = list(live["pools"])
    candidate_queue_pool = (
        4  # current reviewed worker.py; not an inferred old-image bound
    )
    for name in ("api_blue", "api_green", "worker", "migrate"):
        service = services[name]
        if service.get("depends_on") or service.get("entrypoint") is not None:
            raise ValueError("Unsafe candidate dependencies or entrypoint")
        if (
            set(service.get("networks", {"default": None})) != {"default"}
            or service.get("extra_hosts")
            or service.get("dns")
            or service.get("links")
            or service.get("network_mode")
        ):
            raise ValueError("Candidate network resolution differs")
        settings = service["environment"]
        url = urlsplit(settings["DATABASE_URL"])
        if (
            url.scheme != "postgresql+psycopg"
            or url.hostname != expected["database_container"]
            or url.port not in (None, 5432)
            or url.path != "/" + expected["database_name"]
            or url.query
            or url.fragment
            or url.username != expected["database_user"]
            or not url.password
        ):
            raise ValueError("Candidate database endpoint differs")
        cache = urlsplit(settings["REDIS_URL"])
        if (
            cache.scheme != "redis"
            or cache.hostname != expected["cache_container"]
            or cache.port not in (None, 6379)
            or cache.path != "/0"
            or cache.query
            or cache.fragment
        ):
            raise ValueError("Existing rate-limit cache must be preserved")
        if name == "migrate":
            if service.get("command") != ["alembic", "upgrade", "head"]:
                raise ValueError("Unknown migration command")
            continue
        if name == "worker":
            if service.get("command") != ["python", "-m", "app.jobs.worker"]:
                raise ValueError("Unknown worker command")
            count, queue_pool = replicas(service), candidate_queue_pool
        else:
            if service.get("command") is not None:
                raise ValueError("Unknown API command")
            count, queue_pool = (
                replicas(service) * integer(settings["UVICORN_WORKERS"]),
                0,
            )
        if count < 1:
            raise ValueError("Positive process count required")
        pools.append(
            dict(
                processes=count,
                pool_size=integer(settings["DB_POOL_SIZE"]),
                max_overflow=integer(settings["DB_MAX_OVERFLOW"]),
                queue_pool=queue_pool,
            )
        )
    if expected["other_clients"] and other_connections <= 0:
        raise ValueError("Auxiliary database clients need an explicit ceiling")
    result = aggregate_budget(
        pools=pools,
        migration_connections=1,
        reserved=live["reserved"],
        headroom=headroom,
        max_connections=live["max_connections"],
        other_connections=other_connections,
    )
    if not result["fits"]:
        raise ValueError("Live overlap exceeds connection budget")
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected", required=True)
    parser.add_argument("--candidate-config", required=True)
    parser.add_argument("--headroom", type=int, required=True)
    parser.add_argument("--other-connections", type=int, required=True)
    args = parser.parse_args(argv)
    try:
        expected = json.loads(Path(args.expected).read_text())
        config = json.loads(Path(args.candidate_config).read_text())
        result = validate_candidate(
            config,
            expected,
            collect(expected),
            headroom=args.headroom,
            other_connections=args.other_connections,
        )
    except (
        OSError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
        subprocess.SubprocessError,
    ):
        print(
            "FAIL transition identity/inventory/budget preflight; no deployment performed",
            file=sys.stderr,
        )
        return 1
    print(
        json.dumps(dict(status="planning_preflight_passed", **result), sort_keys=True)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
