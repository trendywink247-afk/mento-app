"""Validate independently recovered receipt exports before offline replay.

The checkpoint must be retained independently of the receiver and authenticated
by the operator. Integrity and rollback detection do NOT establish historical
deletion coverage, receipt freshness after a failure, or permission to serve a DB.
No database, network, credentials, or live application configuration is accessed.
"""

import hashlib
import hmac
import json
import re
import uuid
from datetime import datetime

MAX_BYTES = 32 * 1024 * 1024
MAX_RECEIPTS = 100_000
DIGEST = re.compile(r"[0-9a-f]{64}")
FIELDS = {
    "version",
    "store_id",
    "store_created_at",
    "exported_at",
    "coverage",
    "high_water",
    "receipt_count",
    "receipts",
    "sha256",
}
CHECKPOINT_FIELDS = {"version", "store_id", "exported_at", "high_water", "prefix_sha256"}


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def _fail():
    # Never include pseudonymous receipts or source content in errors/logs.
    raise ValueError("Invalid or regressed recovery receipt evidence")


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _fail()
        result[key] = value
    return result


def _time(value):
    try:
        if not isinstance(value, str):
            _fail()
        parsed = datetime.fromisoformat(value)
        if parsed.utcoffset() is None:
            _fail()
        return parsed
    except (ValueError, TypeError, OverflowError):
        _fail()


def _number(value):
    if type(value) is not int or not 0 <= value <= MAX_RECEIPTS:
        _fail()
    return value


def _digest(value):
    if not isinstance(value, str) or DIGEST.fullmatch(value) is None:
        _fail()
    return value


def _parse(raw):
    if not isinstance(raw, bytes) or not 0 < len(raw) <= MAX_BYTES:
        _fail()
    try:
        value = json.loads(raw, object_pairs_hook=_pairs)
        if not isinstance(value, dict) or set(value) != FIELDS:
            _fail()
        if type(value["version"]) is not int or value["version"] != 1:
            _fail()
        if value["coverage"] != "unverified":
            _fail()
        if str(uuid.UUID(value["store_id"])) != value["store_id"]:
            _fail()
        created, exported = _time(value["store_created_at"]), _time(value["exported_at"])
        if exported < created:
            _fail()
        rows = value["receipts"]
        if not isinstance(rows, list) or len(rows) != _number(value["receipt_count"]):
            _fail()
        if _number(value["high_water"]) != len(rows):
            _fail()
        seen = set()
        for sequence, row in enumerate(rows, 1):
            if not isinstance(row, dict) or set(row) != {
                "sequence",
                "member_digest",
                "recorded_at",
            }:
                _fail()
            if _number(row["sequence"]) != sequence:
                _fail()
            digest = _digest(row["member_digest"])
            if digest in seen or not created <= _time(row["recorded_at"]) <= exported:
                _fail()
            seen.add(digest)
        unsigned = {key: item for key, item in value.items() if key != "sha256"}
        if not hmac.compare_digest(
            _digest(value["sha256"]), hashlib.sha256(_canonical(unsigned)).hexdigest()
        ):
            _fail()
        return value
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError, RecursionError):
        raise ValueError("Invalid or regressed recovery receipt evidence") from None


def _prefix(value, high_water):
    return hashlib.sha256(
        _canonical(
            {
                "store_id": value["store_id"],
                "store_created_at": value["store_created_at"],
                "receipts": value["receipts"][:high_water],
            }
        )
    ).hexdigest()


def checkpoint_receipt_export(raw: bytes) -> dict:
    """Create an integrity witness to retain independently; never bless coverage."""
    value = _parse(raw)
    return {
        "version": 1,
        "store_id": value["store_id"],
        "exported_at": value["exported_at"],
        "high_water": value["high_water"],
        "prefix_sha256": _prefix(value, value["high_water"]),
    }


def verify_receipt_export(raw: bytes, checkpoint: dict) -> frozenset[str]:
    """Reject corruption, wrong stores, rollback and changed witnessed history.

    Only returns validated digests; caller must prove complete activation/failure
    coverage independently and isolate the restored database before replaying them.
    """
    value = _parse(raw)
    if not isinstance(checkpoint, dict) or set(checkpoint) != CHECKPOINT_FIELDS:
        _fail()
    if type(checkpoint["version"]) is not int or checkpoint["version"] != 1:
        _fail()
    high_water = _number(checkpoint["high_water"])
    if (
        checkpoint["store_id"] != value["store_id"]
        or high_water > value["high_water"]
        or _time(checkpoint["exported_at"]) > _time(value["exported_at"])
    ):
        _fail()
    if not hmac.compare_digest(_digest(checkpoint["prefix_sha256"]), _prefix(value, high_water)):
        _fail()
    return frozenset(row["member_digest"] for row in value["receipts"])
