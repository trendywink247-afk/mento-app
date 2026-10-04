"""Read-only host/queue metrics; run on the monitored host, never emit secrets."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time


def collect():
    result = {"version": 1, "observed_at": int(time.time())}
    try:
        memory = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
        result["memory_available_mib"] = int(memory["MemAvailable"].split()[0]) // 1024
        result["load_per_cpu"] = os.getloadavg()[0] / (os.cpu_count() or 1)
        result["disk_free_mib"] = shutil.disk_usage(os.environ.get("MONITOR_DISK_PATH", "/")).free // (1024 ** 2)
    except (OSError, ValueError, KeyError):
        result["host_available"] = False
    else:
        result["host_available"] = True
    worker = os.environ.get("MONITOR_WORKER_CONTAINER", "mento-worker-prod")
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", worker):
        try:
            code = (
                "import json; from pathlib import Path; from app.db import SessionLocal; "
                "from app.jobs.health import queue_health; "
                "assert b'app.jobs.worker' in Path('/proc/1/cmdline').read_bytes(); "
                "db=SessionLocal(); h=queue_health(db); db.close(); "
                "print(json.dumps(dict(available=h.get('available'), worker_alive=h.get('worker_alive'), "
                "oldest_queued_seconds=h.get('oldest_queued_seconds'), "
                "failed_24h=sum(h.get('failed_24h', {}).values()))))"
            )
            output = subprocess.run(["docker", "exec", worker, "python", "-c", code],
                                    capture_output=True, text=True, timeout=15, check=True)
            result["queue"] = json.loads(output.stdout)
        except (OSError, ValueError, subprocess.SubprocessError):
            result["queue"] = {"available": False}
    else:
        result["queue"] = {"available": False}
    # A producer writes this atomically ONLY after encrypted archive verification
    # and verified independent copy. File mtime is deliberately not evidence.
    marker = os.environ.get("MONITOR_BACKUP_MARKER")
    try:
        if not marker or Path(marker).stat().st_size > 4096:
            raise ValueError("missing/oversized marker")
        result["backup"] = json.loads(Path(marker).read_text())
    except (OSError, ValueError):
        result["backup"] = None
    attempt = os.environ.get("MONITOR_BACKUP_RESULT")
    if attempt:
        try:
            if Path(attempt).stat().st_size > 4096:
                raise ValueError("oversized result")
            result["backup_result"] = json.loads(Path(attempt).read_text())
        except (OSError, ValueError):
            result["backup_result"] = None
    return result


if __name__ == "__main__":
    print(json.dumps(collect()))
