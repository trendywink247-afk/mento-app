#!/usr/bin/env python3
"""Explicit Linux backup cycle; no schedule, retention deletion or key custody.

Install only after content/deletion coverage and recovery are accepted. This
serializes creation plus verified copy and publishes private monitoring markers.
Only public recipients are passed to the source host; no identity is accepted.
"""

import argparse
import hashlib
import json
import os
import stat
import subprocess
import tempfile
import time
import uuid
from pathlib import Path


def publish(path, value):
    descriptor, temporary = tempfile.mkstemp(prefix=".backup-status-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, separators=(",", ":"), sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def cycle(container, user, database, recipients, directory, destination):
    import fcntl

    directory = Path(directory)
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("An existing private backup directory is required")
    info = directory.stat()
    if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError(
            "Backup directory must be owned by this operator with mode 0700"
        )
    if not Path(recipients).is_file():
        raise ValueError("Public recipient file missing")
    scripts = Path(__file__).resolve().parent
    descriptor = os.open(
        directory / ".backup-cycle.lock",
        os.O_CREAT | os.O_WRONLY | os.O_NOFOLLOW,
        0o600,
    )
    with os.fdopen(descriptor, "w") as lock:
        # A contending invocation must not overwrite the active attempt's status.
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        attempted = int(time.time())
        result = {"version": 1, "status": "failed", "attempted_at": attempted}
        try:
            archive = directory / f"recovery-{attempted}-{uuid.uuid4().hex}.age"
            subprocess.run(
                [
                    "bash",
                    str(scripts / "create-encrypted-recovery.sh"),
                    container,
                    user,
                    database,
                    str(recipients),
                    str(archive),
                ],
                check=True,
                timeout=900,
            )
            subprocess.run(
                [
                    "bash",
                    str(scripts / "copy-encrypted-recovery.sh"),
                    str(archive),
                    destination,
                ],
                check=True,
                timeout=660,
            )
            with archive.open("rb") as encrypted:
                digest = hashlib.file_digest(encrypted, "sha256").hexdigest()
            publish(
                directory / "backup-success.json",
                {
                    "version": 1,
                    "completed_at": int(time.time()),
                    "archive_sha256": digest,
                },
            )
            result["status"] = "success"
        finally:
            publish(directory / "backup-result.json", result)
    print(
        "PASS encrypted archive and verified copy complete; monitoring markers published"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in (
        "container",
        "user",
        "database",
        "recipients",
        "directory",
        "destination",
    ):
        parser.add_argument(argument)
    arguments = parser.parse_args()
    try:
        cycle(**vars(arguments))
    except (OSError, ValueError, subprocess.SubprocessError):
        # Lower-level utilities have their own diagnostics; never dump config.
        raise SystemExit(
            "Backup cycle failed or already active; retained archives are unchanged"
        ) from None
