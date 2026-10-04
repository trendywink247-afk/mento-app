import contextlib
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from recovery_receipt_evidence import (
    checkpoint,
    main,
    read_evidence,
    trusted_checkpoint,
    verify,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services"))
from recovery_receiver.store import Store, canonical, initialize  # noqa: E402


class ReceiptEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        database = self.directory / "receiver.sqlite3"
        initialize(database)
        self.store = Store(database)
        self.export = self.directory / "export.json"
        self.witness = self.directory / "checkpoint.json"
        self.store.record("a" * 64)
        self.export.write_bytes(canonical(self.store.export()))

    def test_checkpoint_roundtrip_and_append_preserves_witnessed_prefix(self):
        trusted = checkpoint(self.export, self.witness)
        self.assertEqual(trusted, hashlib.sha256(self.witness.read_bytes()).hexdigest())
        self.assertEqual(
            verify(self.export, self.witness, trusted), frozenset({"a" * 64})
        )
        self.store.record("b" * 64)
        self.export.write_bytes(canonical(self.store.export()))
        self.assertEqual(len(verify(self.export, self.witness, trusted)), 2)

    def test_checkpoint_publication_refuses_overwrite_and_cleans_temporary(self):
        checkpoint(self.export, self.witness)
        previous = self.witness.read_bytes()
        with self.assertRaises(FileExistsError):
            checkpoint(self.export, self.witness)
        self.assertEqual(self.witness.read_bytes(), previous)
        self.assertEqual(list(self.directory.glob(".receipt-checkpoint-*")), [])
        if os.name == "posix":
            self.assertEqual(self.witness.stat().st_mode & 0o777, 0o600)

    def test_independent_hash_required_before_parsing_checkpoint(self):
        checkpoint(self.export, self.witness)
        self.witness.write_bytes(b"private malformed checkpoint")
        with self.assertRaisesRegex(ValueError, "independently trusted hash"):
            trusted_checkpoint(self.witness, "0" * 64)

    def test_duplicate_checkpoint_keys_refused_even_with_matching_hash(self):
        raw = b'{"version":1,"version":1}'
        self.witness.write_bytes(raw)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            trusted_checkpoint(self.witness, hashlib.sha256(raw).hexdigest())

    def test_wrong_store_and_rollback_refused_against_existing_witness(self):
        old_export = self.export.read_bytes()
        self.store.record("b" * 64)
        self.export.write_bytes(canonical(self.store.export()))
        trusted = checkpoint(self.export, self.witness)
        self.export.write_bytes(old_export)
        with self.assertRaises(ValueError):
            verify(self.export, self.witness, trusted)
        other = self.directory / "other.sqlite3"
        initialize(other)
        self.export.write_bytes(canonical(Store(other).export()))
        with self.assertRaises(ValueError):
            verify(self.export, self.witness, trusted)

    def test_bounded_reads_reject_empty_oversized_and_nonregular_files(self):
        for raw in [b"", b"12345"]:
            self.export.write_bytes(raw)
            with self.assertRaises(ValueError):
                read_evidence(self.export, 4)
        with self.assertRaises((OSError, ValueError)):
            read_evidence(self.directory, 4)

    def test_cli_errors_do_not_expose_paths_or_source_contents(self):
        self.export.write_bytes(b"private@example.test")
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            result = main(
                [
                    "checkpoint",
                    "--export",
                    str(self.export),
                    "--output",
                    str(self.witness),
                    "--authenticated-retrieval-confirmed",
                ]
            )
        self.assertEqual(result, 1)
        self.assertNotIn("private", stderr.getvalue())
        self.assertNotIn(str(self.export), stderr.getvalue())
        self.assertFalse(self.witness.exists())

    def test_cli_verify_reports_counts_only_without_claiming_coverage(self):
        trusted = checkpoint(self.export, self.witness)
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            result = main(
                [
                    "verify",
                    "--export",
                    str(self.export),
                    "--checkpoint",
                    str(self.witness),
                    "--trusted-checkpoint-sha256",
                    trusted,
                ]
            )
        self.assertEqual(result, 0)
        self.assertEqual(
            json.loads(stdout.getvalue()),
            {"validated_receipt_count": 1, "coverage": "unverified"},
        )
        self.assertNotIn("a" * 64, stdout.getvalue())


if __name__ == "__main__":
    unittest.main()
