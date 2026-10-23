#!/usr/bin/env python3
"""Prove two compose files describe the same containers, so compose adopts the live ones.

    ops/compare-compose.py <old.json> <new.json> [--expect-old-image mento-api:92b8f57a5cd3]

Each argument is the output of `docker compose ... config --format json` (a path, or a
bash process substitution `<(docker compose ... config --format json)` so the resolved
environment, which holds secrets, never lands on disk). Only service names, container
names, images, ports and volumes are read and printed. Environment values are never
printed.

Checked for api, postgres and redis (and worker when both files have one):
  - the service exists in both, under the same service name;
  - container_name is identical (otherwise compose creates new containers beside the old
    ones, or fails on the name clash);
  - postgres and redis: same image and same volume mounts; api: same published ports;
  - both files declare the same named volumes.
With --expect-old-image, the OLD file's api service must resolve to exactly that image.

Exit 0 when everything matches, 1 on any difference (details on stdout), 2 on bad input.
"""

from __future__ import annotations

import json
import sys

REQUIRED = ("api", "postgres", "redis")
OPTIONAL = ("worker",)


def _volume(v) -> str:
    if isinstance(v, dict):
        return f"{v.get('source', '')}:{v.get('target', '')}"
    return str(v).split(":ro")[0]


def _port(p) -> str:
    if isinstance(p, dict):
        return f"{p.get('host_ip', '')}:{p.get('published', '')}:{p.get('target', '')}"
    return str(p)


def facts(service: dict) -> dict:
    return {
        "container_name": service.get("container_name"),
        "image": service.get("image"),
        "ports": sorted(_port(p) for p in service.get("ports", []) or []),
        "volumes": sorted(_volume(v) for v in service.get("volumes", []) or []),
    }


def compare(old: dict, new: dict, expect_old_image: str | None = None) -> list[str]:
    problems: list[str] = []
    old_services = old.get("services", {}) or {}
    new_services = new.get("services", {}) or {}
    for name in REQUIRED + tuple(n for n in OPTIONAL if n in old_services and n in new_services):
        if name not in old_services:
            problems.append(f"service {name!r} missing from the OLD file")
            continue
        if name not in new_services:
            problems.append(f"service {name!r} missing from the NEW file")
            continue
        a, b = facts(old_services[name]), facts(new_services[name])
        if a["container_name"] != b["container_name"]:
            problems.append(
                f"{name}: container_name differs: old={a['container_name']!r} new={b['container_name']!r}"
            )
        if name in ("postgres", "redis"):
            for key in ("image", "volumes"):
                if a[key] != b[key]:
                    problems.append(f"{name}: {key} differs: old={a[key]!r} new={b[key]!r}")
        if name == "api" and a["ports"] != b["ports"]:
            problems.append(f"api: ports differ: old={a['ports']!r} new={b['ports']!r}")
    if sorted((old.get("volumes") or {}).keys()) != sorted((new.get("volumes") or {}).keys()):
        problems.append(
            "named volumes differ: "
            f"old={sorted((old.get('volumes') or {}).keys())} new={sorted((new.get('volumes') or {}).keys())}"
        )
    if expect_old_image is not None:
        got = facts(old_services.get("api", {}))["image"]
        if got != expect_old_image:
            problems.append(f"OLD api resolves to image {got!r}, expected {expect_old_image!r}")
    return problems


def summary(config: dict) -> list[str]:
    lines = []
    for name, svc in sorted((config.get("services") or {}).items()):
        f = facts(svc)
        lines.append(f"  {name}: container_name={f['container_name']} image={f['image']} ports={f['ports']}")
    return lines


def main(argv: list[str]) -> int:
    expect = None
    args = list(argv)
    if "--expect-old-image" in args:
        i = args.index("--expect-old-image")
        try:
            expect = args[i + 1]
        except IndexError:
            print("--expect-old-image needs a value", file=sys.stderr)
            return 2
        del args[i : i + 2]
    if len(args) != 2:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        old, new = (json.load(open(p)) for p in args)
    except (OSError, ValueError) as exc:
        print(f"cannot read compose JSON: {exc}", file=sys.stderr)
        return 2
    print("OLD file:")
    print("\n".join(summary(old)))
    print("NEW file:")
    print("\n".join(summary(new)))
    problems = compare(old, new, expect)
    if problems:
        print("MISMATCH, STOP:")
        print("\n".join(f"  - {p}" for p in problems))
        return 1
    print("MATCH: same services, container names, images, ports and volumes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
