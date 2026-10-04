"""Read-only topology-aware runtime identity checks, independent of classic receiver."""

import argparse
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location(
    "preparation", Path(__file__).with_name("prepare-transition.py")
)
preparation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preparation)
preflight = preparation.preflight

HEARTBEAT = """
import json
from app.db import SessionLocal
from app.jobs.health import queue_health
db=SessionLocal()
try:
    h=queue_health(db)
    print(json.dumps(dict(available=h.get('available'), worker_alive=h.get('worker_alive'))))
finally:
    db.close()
"""


def verify(expected, release, roles):
    if (
        not isinstance(roles, dict)
        or set(roles) - {"api_blue", "api_green", "worker"}
        or "worker" not in roles
        or not {"api_blue", "api_green"} & set(roles)
    ):
        raise ValueError("Explicit API color and worker inventory required")
    if any(not isinstance(name, str) for name in roles.values()) or len(
        set(roles.values())
    ) != len(roles):
        raise ValueError("Unique runtime containers required")
    preparation.release_identity(release)
    # Re-inventory baseline leftovers in expected.old_clients explicitly. Keep
    # retained DB/cache identities unchanged; reject any unexpected new writer.
    checked = dict(
        expected, old_clients=sorted(set(expected["old_clients"]) | set(roles.values()))
    )
    live = preflight.collect(checked)
    if sum(p["processes"] for p in live["pools"] if p["queue_pool"] > 0) != 1:
        raise ValueError("One authorized scheduler required")
    for role, name in roles.items():
        container = json.loads(preflight.run(["docker", "inspect", name]))
        if (
            len(container) != 1
            or container[0]["Image"] != release["runtime_image_id"]
            or container[0]["State"].get("Running") is not True
        ):
            raise ValueError("Runtime image differs or is stopped")
        pool = json.loads(
            preflight.run(
                ["docker", "exec", "-i", name, "python", "-"],
                input=preflight.POOL_PROBE,
            )
        )
        if (
            pool.get("system_identifier") != expected["system_identifier"]
            or pool.get("database_oid") != expected["database_oid"]
        ):
            raise ValueError("Runtime database identity differs")
        if (role == "worker") != (pool["queue_pool"] > 0):
            raise ValueError("Runtime role command differs")
        if role == "worker":
            health = json.loads(
                preflight.run(
                    ["docker", "exec", "-i", name, "python", "-"], input=HEARTBEAT
                )
            )
            if (
                health.get("available") is not True
                or health.get("worker_alive") is not True
            ):
                raise ValueError("Queue heartbeat unavailable")
        elif container[0]["State"].get("Health", {}).get("Status") != "healthy":
            raise ValueError("API not healthy")
    return dict(
        status="runtime_identity_checks_passed",
        sha=release["sha"],
        api_colors=sorted(set(roles) - {"worker"}),
        worker_command_and_queue_heartbeat=True,
        production_acceptance=False,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("expected", "release", "roles", "state-dir"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args(argv)
    try:
        with preparation.deploy_lock(args.state_dir):
            result = verify(
                json.loads(Path(args.expected).read_text()),
                json.loads(Path(args.release).read_text()),
                json.loads(Path(args.roles).read_text()),
            )
    except (
        OSError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
        preflight.subprocess.SubprocessError,
    ):
        print("FAIL locked runtime identity verification", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
