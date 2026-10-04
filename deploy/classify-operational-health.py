"""Strict operational evidence classifier. Prints labels only, never payloads."""
import json
import math
import os
import re
import sys
import time


def number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value) and value >= 0
    except OverflowError:
        return False


def checks(payload, now=None, limits=None):
    now = time.time() if now is None else now
    limits = limits or dict(memory=128, disk=1024, load=2, backlog=300, failed=0, backup=28800)
    bad = dict(host=False, worker=False, backlog=False, backup=False)
    if not isinstance(payload, dict) or type(payload.get("version")) is not int or payload["version"] != 1:
        return bad
    observed = payload.get("observed_at")
    if not number(observed) or not 0 <= now - observed <= 120:
        return bad
    memory, disk, load = (payload.get(name) for name in ("memory_available_mib", "disk_free_mib", "load_per_cpu"))
    host = (payload.get("host_available") is True and all(number(v) for v in (memory, disk, load))
            and memory >= limits["memory"] and disk >= limits["disk"] and load <= limits["load"])
    queue = payload.get("queue")
    queue = queue if isinstance(queue, dict) else {}
    available = queue.get("available") is True
    age, failed = queue.get("oldest_queued_seconds"), queue.get("failed_24h")
    backlog = (available and (age is None or (number(age) and age <= limits["backlog"]))
               and type(failed) is int and 0 <= failed <= limits["failed"])
    marker = payload.get("backup")
    marker = marker if isinstance(marker, dict) else {}
    completed = marker.get("completed_at")
    backup = (type(marker.get("version")) is int and marker["version"] == 1 and number(completed)
              and 0 <= now - completed <= limits["backup"]
              and isinstance(marker.get("archive_sha256"), str)
              and re.fullmatch(r"[0-9a-f]{64}", marker["archive_sha256"]) is not None)
    if "backup_result" in payload:
        attempt = payload["backup_result"]
        attempt = attempt if isinstance(attempt, dict) else {}
        at = attempt.get("attempted_at")
        backup = (backup and type(attempt.get("version")) is int and attempt["version"] == 1
                  and attempt.get("status") == "success" and number(at)
                  and 0 <= now - at <= limits["backup"])
    return dict(host=bool(host), worker=available and queue.get("worker_alive") is True,
                backlog=bool(backlog), backup=bool(backup))


if __name__ == "__main__":
    try:
        raw = sys.stdin.read(65537)
        if len(raw) > 65536:
            raise ValueError("oversized")
        limits = {name: float(os.environ.get(env, default)) for name, env, default in (
            ("memory", "MONITOR_MIN_MEMORY_MIB", 128), ("disk", "MONITOR_MIN_DISK_MIB", 1024),
            ("load", "MONITOR_MAX_LOAD_PER_CPU", 2), ("backlog", "MONITOR_MAX_BACKLOG_SECONDS", 300),
            ("failed", "MONITOR_MAX_FAILED_JOBS", 0), ("backup", "MONITOR_MAX_BACKUP_AGE_SECONDS", 28800))}
        if not all(number(value) for value in limits.values()):
            raise ValueError("invalid limits")
        result = checks(json.loads(raw), limits=limits)
    except (ValueError, TypeError):
        result = dict(host=False, worker=False, backlog=False, backup=False)
    for name, passed in result.items():
        print(f'{"PASS" if passed else "FAIL"} operational-{name}')
    sys.exit(0 if all(result.values()) else 1)
