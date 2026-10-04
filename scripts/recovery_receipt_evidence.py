"""Offline receipt witness tooling; no network, database or private key access.

Source authenticity comes from separately accepted retrieval and independently
held checkpoint hashes. Never mint a new witness from suspect recovered evidence.
Integrity checks do not establish deletion coverage or authorize serving a restore.
"""

import argparse
import hashlib
import hmac
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api"))
from app.services.recovery_manifest import (  # noqa: E402
    MAX_BYTES,
    checkpoint_receipt_export,
    verify_receipt_export,
)

CHECKPOINT_MAX_BYTES = 8192


def read_evidence(path: Path, limit: int) -> bytes:
    if path.is_symlink():
        raise ValueError("Evidence must be a regular private file")
    descriptor = os.open(
        path,
        os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0),
    )
    with os.fdopen(descriptor, "rb") as source:
        metadata = os.fstat(source.fileno())
        if not stat.S_ISREG(metadata.st_mode) or not 0 < metadata.st_size <= limit:
            raise ValueError("Evidence file size or type is invalid")
        raw = source.read(limit + 1)
    if not 0 < len(raw) <= limit:
        raise ValueError("Evidence file size is invalid")
    return raw


def _pairs(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate checkpoint field")
        value[key] = item
    return value


def trusted_checkpoint(path: Path, trusted_sha256: str) -> dict:
    if (
        not isinstance(trusted_sha256, str)
        or re.fullmatch(r"[0-9a-f]{64}", trusted_sha256) is None
    ):
        raise ValueError("An independently trusted checkpoint hash is required")
    raw = read_evidence(path, CHECKPOINT_MAX_BYTES)
    if not hmac.compare_digest(hashlib.sha256(raw).hexdigest(), trusted_sha256):
        raise ValueError("Checkpoint does not match the independently trusted hash")
    value = json.loads(raw, object_pairs_hook=_pairs)
    if not isinstance(value, dict):
        raise ValueError("Invalid checkpoint")
    return value


def _sync_directory(directory: Path) -> None:
    if os.name == "posix":
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def checkpoint(export_path: Path, destination: Path) -> str:
    """Run only after operator-authenticated export retrieval; not on a restore."""
    witness = checkpoint_receipt_export(read_evidence(export_path, MAX_BYTES))
    raw = json.dumps(witness, sort_keys=True, separators=(",", ":")).encode() + b"\n"
    descriptor, temporary = tempfile.mkstemp(
        prefix=".receipt-checkpoint-", dir=destination.parent
    )
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, destination)  # non-overwriting, even if another writer races
        _sync_directory(destination.parent)
    finally:
        os.unlink(temporary)
    return hashlib.sha256(raw).hexdigest()


def verify(
    export_path: Path, checkpoint_path: Path, trusted_sha256: str
) -> frozenset[str]:
    witness = trusted_checkpoint(checkpoint_path, trusted_sha256)
    return verify_receipt_export(read_evidence(export_path, MAX_BYTES), witness)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("checkpoint")
    create.add_argument("--export", required=True, type=Path)
    create.add_argument("--output", required=True, type=Path)
    create.add_argument(
        "--authenticated-retrieval-confirmed", required=True, action="store_true"
    )
    check = commands.add_parser("verify")
    check.add_argument("--export", required=True, type=Path)
    check.add_argument("--checkpoint", required=True, type=Path)
    check.add_argument("--trusted-checkpoint-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "checkpoint":
            sha256 = checkpoint(args.export, args.output)
            print(json.dumps({"checkpoint_sha256": sha256, "coverage": "unverified"}))
        else:
            digests = verify(
                args.export, args.checkpoint, args.trusted_checkpoint_sha256
            )
            print(
                json.dumps(
                    {"validated_receipt_count": len(digests), "coverage": "unverified"}
                )
            )
        return 0
    except (OSError, ValueError, TypeError, RecursionError):
        # No paths, member digests, source contents or parser exceptions in logs.
        print(
            "Receipt evidence operation refused; coverage remains unverified",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
