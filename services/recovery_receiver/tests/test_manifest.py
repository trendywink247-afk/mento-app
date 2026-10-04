"""Real receiver exports consumed by the API's offline verifier; no API DB."""

import copy
import hashlib
import json

import pytest
from app.services.recovery_manifest import checkpoint_receipt_export, verify_receipt_export
from recovery_receiver.store import Store, canonical, initialize


@pytest.fixture
def store(tmp_path):
    path = tmp_path / "receipts.sqlite3"
    initialize(path)
    return Store(path)


def encode(value):
    value = copy.deepcopy(value)
    value.pop("sha256", None)
    value["sha256"] = hashlib.sha256(canonical(value)).hexdigest()
    return canonical(value)


def test_real_export_roundtrip_and_append(store):
    store.record("a" * 64)
    first = canonical(store.export())
    checkpoint = checkpoint_receipt_export(first)
    assert verify_receipt_export(first, checkpoint) == {"a" * 64}
    store.record("b" * 64)
    assert verify_receipt_export(canonical(store.export()), checkpoint) == {"a" * 64, "b" * 64}


def test_empty_store_witness_allows_first_receipt(store):
    checkpoint = checkpoint_receipt_export(canonical(store.export()))
    store.record("a" * 64)
    assert verify_receipt_export(canonical(store.export()), checkpoint) == {"a" * 64}


def test_older_export_refused_against_independent_watermark(store):
    old = canonical(store.export())
    store.record("a" * 64)
    checkpoint = checkpoint_receipt_export(canonical(store.export()))
    with pytest.raises(ValueError):
        verify_receipt_export(old, checkpoint)


def test_same_store_rewritten_history_refused_even_with_recomputed_checksum(store):
    store.record("a" * 64)
    value = store.export()
    checkpoint = checkpoint_receipt_export(canonical(value))
    value["receipts"][0]["member_digest"] = "b" * 64
    with pytest.raises(ValueError):
        verify_receipt_export(encode(value), checkpoint)


def test_unrelated_store_refused(store, tmp_path):
    checkpoint = checkpoint_receipt_export(canonical(store.export()))
    other = tmp_path / "other.sqlite3"
    initialize(other)
    with pytest.raises(ValueError):
        verify_receipt_export(canonical(Store(other).export()), checkpoint)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda v: v.update(coverage="complete"),
        lambda v: v.update(version=True),
        lambda v: v.update(high_water=True),
        lambda v: v.update(receipt_count=2),
        lambda v: v.update(extra="unexpected"),
        lambda v: v.update(exported_at="2000-01-01T00:00:00+00:00"),
        lambda v: v.update(exported_at="2026-10-05"),
        lambda v: v["receipts"][0].update(sequence=2),
        lambda v: v["receipts"][0].update(sequence=True),
        lambda v: v["receipts"][0].update(member_digest="NOT_A_DIGEST"),
        lambda v: v["receipts"][0].update(recorded_at="2999-01-01T00:00:00+00:00"),
        lambda v: v["receipts"][0].update(secret="unexpected"),
    ],
)
def test_malformed_export_rejected_even_with_valid_checksum(store, mutation):
    store.record("a" * 64)
    value = store.export()
    mutation(value)
    with pytest.raises(ValueError):
        checkpoint_receipt_export(encode(value))


def test_duplicate_digest_and_missing_sequence_refused(store):
    store.record("a" * 64)
    store.record("b" * 64)
    value = store.export()
    value["receipts"][1]["member_digest"] = "a" * 64
    with pytest.raises(ValueError):
        checkpoint_receipt_export(encode(value))
    value = store.export()
    value["receipts"].pop(0)
    value["receipt_count"] = 1
    with pytest.raises(ValueError):
        checkpoint_receipt_export(encode(value))


def test_corrupt_bytes_duplicate_json_keys_and_oversize_refused(store):
    value = store.export()
    value["sha256"] = "0" * 64
    for raw in (canonical(value), b'{"version":1,"version":1}', b"x" * (32 * 1024 * 1024 + 1)):
        with pytest.raises(ValueError):
            checkpoint_receipt_export(raw)


def test_checkpoint_is_required_and_error_does_not_reveal_content(store):
    store.record("a" * 64)
    raw = canonical(store.export())
    for checkpoint in (None, {}, {"member_digest": "a" * 64}):
        with pytest.raises(ValueError) as error:
            verify_receipt_export(raw, checkpoint)
        assert "a" * 64 not in str(error.value)
    assert json.loads(raw)["coverage"] == "unverified"
