"""Offline connection budget; inputs must match effective deployment settings."""
import argparse
import json


def budget(*, api_processes, worker_processes, pool_size, max_overflow,
           queue_pool, migration_connections, reserved, headroom, max_connections):
    values = locals().copy()
    if any(type(value) is not int or value < 0 for value in values.values()):
        raise ValueError("All inputs must be nonnegative integers")
    if pool_size == 0 or max_connections == 0:
        raise ValueError("A finite positive pool and server limit are required")
    # Each worker has its own SQLAlchemy pool AND a separate queue connector.
    application = ((api_processes + worker_processes) * (pool_size + max_overflow)
                   + worker_processes * queue_pool + migration_connections)
    required = application + reserved + headroom
    return {"application_ceiling": application, "required": required,
            "server_limit": max_connections, "remaining": max_connections - required,
            "fits": required <= max_connections}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("api_processes", "worker_processes", "pool_size", "max_overflow",
                 "queue_pool", "migration_connections", "reserved", "headroom",
                 "max_connections"):
        parser.add_argument("--" + name.replace("_", "-"), type=int, required=True)
    try:
        result = budget(**vars(parser.parse_args()))
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["fits"] else 1)
