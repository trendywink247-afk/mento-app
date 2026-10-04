"""Check a rendered Balanced Compose plan without printing environment values.

This checks the supplied desired topology, not running containers. To assess a
deployment overlap, supply the old color's effective configuration as well as
the new color's configuration. Image defaults are intentionally not inferred.
Other database clients require an explicit independently established allowance.
"""
import argparse
import json
import re
import sys

from database_budget import aggregate_budget


def integer(value):
    # Do not include rejected values in errors: rendered environments may contain
    # secrets. Avoid int()'s diagnostic, which would repeat the original input.
    if type(value) is int and value >= 0:
        return value
    if isinstance(value, str) and re.fullmatch(r"[0-9]+", value):
        return int(value)
    raise ValueError("An explicit nonnegative integer setting is required")


def replicas(service):
    scale = integer(service.get("scale", 1))
    deployed = service.get("deploy", {}).get("replicas")
    if deployed is not None:
        deployed = integer(deployed)
        if "scale" in service and scale != deployed:
            raise ValueError("Conflicting service replica counts")
        scale = deployed
    if scale == 0:
        raise ValueError("Budgeted services must have at least one replica")
    return scale


def rendered_budget(config, *, queue_pool, migration_connections, reserved,
                    headroom, other_connections):
    """Both colors are counted even when the green Compose profile is inactive."""
    try:
        services = config["services"]
        pools = []
        for name in ("api_blue", "api_green", "worker"):
            service = services[name]
            env = service["environment"]
            if service.get("entrypoint") is not None:
                raise ValueError("Custom entrypoints require an explicit topology review")
            if name == "worker":
                if service.get("command") != ["python", "-m", "app.jobs.worker"]:
                    raise ValueError("Unknown worker command; topology review required")
                processes = replicas(service)
                queue = queue_pool
            else:
                if service.get("command") is not None:
                    raise ValueError("Custom API commands require an explicit topology review")
                workers = integer(env["UVICORN_WORKERS"])
                if workers == 0:
                    raise ValueError("API worker count must be positive")
                processes = replicas(service) * workers
                queue = 0
            pools.append(dict(processes=processes,
                              pool_size=integer(env["DB_POOL_SIZE"]),
                              max_overflow=integer(env["DB_MAX_OVERFLOW"]),
                              queue_pool=queue))
        command = services["postgres"]["command"]
        if not isinstance(command, list):
            raise ValueError("Postgres command must explicitly set its connection limit")
        limits = [value.split("=", 1)[1] for value in command
                  if isinstance(value, str) and value.startswith("max_connections=")]
        if len(limits) != 1:
            raise ValueError("Exactly one Postgres connection limit is required")
        limit = integer(limits[0])
    except (KeyError, TypeError, AttributeError):
        raise ValueError("Incomplete rendered Balanced topology") from None
    return aggregate_budget(pools=pools,
                            migration_connections=migration_connections,
                            reserved=reserved, headroom=headroom,
                            max_connections=limit, other_connections=other_connections)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("rendered_config", help="Compose JSON file, or - for stdin")
    for name in ("queue_pool", "migration_connections", "reserved", "headroom",
                 "other_connections"):
        parser.add_argument("--" + name.replace("_", "-"), type=int, required=True)
    args = vars(parser.parse_args(argv))
    path = args.pop("rendered_config")
    try:
        if path == "-":
            config = json.load(sys.stdin)
        else:
            with open(path, encoding="utf-8") as source:
                config = json.load(source)
        result = rendered_budget(config, **args)
    except (OSError, ValueError):
        # No paths, configuration fragments or environment values in diagnostics.
        print("Invalid or incomplete database budget input", file=sys.stderr)
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0 if result["fits"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
