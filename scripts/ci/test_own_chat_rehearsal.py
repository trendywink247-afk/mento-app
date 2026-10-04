"""Evidence calculations and fault-target guards; no Docker or chat service."""

import asyncio
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

SCRIPT = Path(__file__).resolve().parents[2] / "deploy/rehearse-own-chat.py"
spec = importlib.util.spec_from_file_location("own_chat_rehearsal", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class OwnChatRehearsalTests(unittest.TestCase):
    def test_nearest_rank_percentiles_and_sample_count(self):
        result = mod.percentiles(list(range(20, 0, -1)))
        self.assertEqual(
            result, {"samples": 20, "p50_ms": 10, "p95_ms": 19, "max_ms": 20}
        )

    def test_empty_measurement_refused(self):
        with self.assertRaises(ValueError):
            mod.percentiles([])

    def test_replay_missing_duplicate_and_reordered_rejected(self):
        for rows in [
            [],
            [{"client_id": "a", "seq": 1}] * 2,
            [{"client_id": "b", "seq": 2}, {"client_id": "a", "seq": 1}],
            [{"client_id": "a", "seq": 1}, {"client_id": "b", "seq": 1}],
        ]:
            with self.subTest(rows=rows), self.assertRaises(AssertionError):
                mod.verify_replay(rows, ["a", "b"])

    def test_exact_replay_accepted(self):
        mod.verify_replay(
            [{"client_id": "a", "seq": 2}, {"client_id": "b", "seq": 3}], ["a", "b"]
        )

    def test_replay_sequence_gap_or_reversal_rejected(self):
        for seqs in [(1, 3), (3, 2)]:
            with self.subTest(seqs=seqs), self.assertRaises(AssertionError):
                mod.verify_replay(
                    [
                        {"client_id": "a", "seq": seqs[0]},
                        {"client_id": "b", "seq": seqs[1]},
                    ],
                    ["a", "b"],
                )

    def test_unexpected_message_cannot_be_silently_skipped(self):
        async def recv():
            return json.dumps(
                {"t": "message", "message": {"client_id": "old-duplicate"}}
            )

        with self.assertRaises(AssertionError):
            asyncio.run(
                mod.frame(SimpleNamespace(recv=recv), "message", "next-expected")
            )

    def test_fault_target_requires_recorded_owned_identity(self):
        helper = SimpleNamespace(
            created=[("container", "api-a", "original")],
            ownership=Mock(return_value="replacement"),
        )
        with self.assertRaises(ValueError):
            mod.owned_id(helper, "api-a")
        with self.assertRaises(ValueError):
            mod.owned_id(helper, "unrecorded")
        helper.ownership.return_value = "original"
        self.assertEqual(mod.owned_id(helper, "api-a"), "original")

    def test_unexpected_duplicate_after_replay_is_rejected(self):
        async def recv():
            return json.dumps({"t": "message", "message": {"client_id": "duplicate"}})

        with self.assertRaises(AssertionError):
            asyncio.run(mod.no_extra_messages(SimpleNamespace(recv=recv)))

    def test_held_or_error_frame_cannot_be_counted_as_ack(self):
        for kind in ("held", "error"):

            async def recv():
                return json.dumps({"t": kind})

            with self.subTest(kind=kind), self.assertRaises(AssertionError):
                asyncio.run(mod.frame(SimpleNamespace(recv=recv), "message"))


if __name__ == "__main__":
    unittest.main()
