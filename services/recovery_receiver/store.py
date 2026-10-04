"""Append-only receipt storage on an operator-provisioned, local SQLite volume.

FULL synchronous commits are the acknowledgement boundary. Hardware/host durability,
off-host copies, and historical deletion coverage still require operational proof.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import tempfile
import uuid
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

DIGEST = re.compile(r"[0-9a-f]{64}")


def now() -> str:
    return datetime.now(UTC).isoformat()


def canonical(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sync_directory(directory: Path) -> None:
    # Windows has no portable directory fsync through os.open. Production is Linux;
    # Windows tests establish behavior, not power-loss durability on the target host.
    if os.name == "posix":
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def initialize(path: Path) -> str:
    """Create a NEW store explicitly. Serving/export never creates an empty store."""
    path = path.absolute()
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    identity = str(uuid.uuid4())
    with closing(sqlite3.connect(path, isolation_level=None)) as connection:
        if connection.execute("PRAGMA journal_mode=WAL").fetchone()[0] != "wal":
            raise sqlite3.OperationalError("WAL storage required")
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("BEGIN IMMEDIATE")
        try:
            connection.execute(
                "CREATE TABLE metadata (singleton INTEGER PRIMARY KEY CHECK(singleton=1), "
                "schema_version INTEGER NOT NULL CHECK(schema_version=1), "
                "store_id TEXT NOT NULL, created_at TEXT NOT NULL)"
            )
            connection.execute("INSERT INTO metadata VALUES (1, 1, ?, ?)", (identity, now()))
            connection.execute(
                "CREATE TABLE receipts (sequence INTEGER PRIMARY KEY AUTOINCREMENT, "
                "member_digest TEXT NOT NULL UNIQUE "
                "CHECK(length(member_digest)=64 AND member_digest NOT GLOB '*[^0-9a-f]*'), "
                "recorded_at TEXT NOT NULL)"
            )
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
    sync_directory(path.parent)
    return identity


class Store:
    def __init__(self, path: Path):
        self.path = path.absolute()
        if self.path.is_symlink():
            raise ValueError("Receipt store must be a regular local file")
        with closing(self._connect()) as connection:
            metadata = connection.execute(
                "SELECT schema_version, store_id FROM metadata WHERE singleton=1"
            ).fetchone()
            if metadata is None or metadata[0] != 1:
                raise ValueError("Unsupported receipt store")
            self.identity = str(uuid.UUID(metadata[1]))

    def _connect(self) -> sqlite3.Connection:
        # mode=rw is critical: missing storage must not silently become a new ledger.
        connection = sqlite3.connect(
            self.path.as_uri() + "?mode=rw", uri=True, timeout=5.0, isolation_level=None
        )
        try:
            if connection.execute("PRAGMA journal_mode").fetchone()[0] != "wal":
                raise sqlite3.OperationalError("WAL storage required")
            connection.execute("PRAGMA synchronous=FULL")
            return connection
        except BaseException:
            connection.close()
            raise

    def _metadata(self, connection: sqlite3.Connection) -> tuple:
        row = connection.execute(
            "SELECT store_id, created_at FROM metadata WHERE singleton=1 AND schema_version=1"
        ).fetchone()
        if row is None or row[0] != self.identity:
            raise sqlite3.DatabaseError("Receipt store identity changed")
        return row

    def record(self, member_digest: str) -> None:
        if not isinstance(member_digest, str) or DIGEST.fullmatch(member_digest) is None:
            raise ValueError("Invalid receipt digest")
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                self._metadata(connection)
                # Serialize first-seen inserts and retries without consuming a new
                # sequence for duplicates. The receipt and original timestamp stay.
                exists = connection.execute(
                    "SELECT 1 FROM receipts WHERE member_digest=?", (member_digest,)
                ).fetchone()
                if exists is None:
                    connection.execute(
                        "INSERT INTO receipts(member_digest, recorded_at) VALUES (?, ?)",
                        (member_digest, now()),
                    )
                connection.commit()
            except BaseException:
                connection.rollback()
                raise

    def export(self) -> dict:
        with closing(self._connect()) as connection:
            # Metadata and rows belong to one read snapshot even while writes arrive.
            connection.execute("BEGIN")
            identity, created = self._metadata(connection)
            rows = connection.execute(
                "SELECT sequence, member_digest, recorded_at FROM receipts ORDER BY sequence"
            ).fetchall()
            connection.commit()
        manifest = {
            "version": 1,
            "store_id": identity,
            "store_created_at": created,
            "exported_at": now(),
            "coverage": "unverified",
            "high_water": rows[-1][0] if rows else 0,
            "receipt_count": len(rows),
            "receipts": [
                {"sequence": sequence, "member_digest": digest, "recorded_at": timestamp}
                for sequence, digest, timestamp in rows
            ],
        }
        return {**manifest, "sha256": hashlib.sha256(canonical(manifest)).hexdigest()}


def publish_export(store: Store, destination: Path) -> None:
    """Private, non-overwriting publication; no HTTP export endpoint exists."""
    destination = destination.absolute()
    descriptor, temporary = tempfile.mkstemp(prefix=".receipts-", dir=destination.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(canonical(store.export()) + b"\n")
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, destination)
        sync_directory(destination.parent)
    finally:
        os.unlink(temporary)
