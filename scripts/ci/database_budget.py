"""Offline connection budget; inputs must match effective deployment settings."""
import argparse
import json


def aggregate_budget(*, pools, migration_connections, reserved, headroom,
                     max_connections, other_connections):
    """Sum independently bounded pools (including asymmetric deployment colors).

    Each pool has processes, pool_size, max_overflow and queue_pool. API pools
    use queue_pool=0; each worker process owns an additional queue connector.
    other_connections is an explicit aggregate ceiling for all other clients.
    """
    allowances = (migration_connections, reserved, headroom, max_connections,
                  other_connections)
    if any(type(value) is not int or value < 0 for value in allowances):
        raise ValueError("Allowances must be nonnegative integers")
    if max_connections == 0:
        raise ValueError("A finite positive server limit is required")
    application = migration_connections + other_connections
    if not pools:
        raise ValueError("At least one bounded pool is required")
    for pool in pools:
        if set(pool) != {"processes", "pool_size", "max_overflow", "queue_pool"}:
            raise ValueError("Every pool must specify process and connection bounds")
        if any(type(value) is not int or value < 0 for value in pool.values()):
            raise ValueError("Pool bounds must be nonnegative integers")
        if pool["pool_size"] == 0:
            raise ValueError("A finite positive pool size is required")
        application += pool["processes"] * (
            pool["pool_size"] + pool["max_overflow"] + pool["queue_pool"])
    required = application + reserved + headroom
    return {"application_ceiling": application, "required": required,
            "server_limit": max_connections, "remaining": max_connections - required,
            "fits": required <= max_connections}


def budget(*, api_processes, worker_processes, pool_size, max_overflow,
           queue_pool, migration_connections, reserved, headroom, max_connections,
           other_connections):
    values = locals().copy()
    if any(type(value) is not int or value < 0 for value in values.values()):
        raise ValueError("All inputs must be nonnegative integers")
    if pool_size == 0 or max_connections == 0:
        raise ValueError("A finite positive pool and server limit are required")
    return aggregate_budget(pools=[
        dict(processes=api_processes, pool_size=pool_size,
             max_overflow=max_overflow, queue_pool=0),
        dict(processes=worker_processes, pool_size=pool_size,
             max_overflow=max_overflow, queue_pool=queue_pool),
    ], migration_connections=migration_connections, reserved=reserved,
        headroom=headroom, max_connections=max_connections,
        other_connections=other_connections)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("api_processes", "worker_processes", "pool_size", "max_overflow",
                 "queue_pool", "migration_connections", "reserved", "headroom",
                 "max_connections", "other_connections"):
        parser.add_argument("--" + name.replace("_", "-"), type=int, required=True)
    try:
        result = budget(**vars(parser.parse_args()))
    except ValueError as exc:
        parser.error(str(exc))
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["fits"] else 1)
