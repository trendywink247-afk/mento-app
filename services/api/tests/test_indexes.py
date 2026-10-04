"""T2.2: the hot list queries have composite indexes that match their shape.

`pg_indexes` proves the index exists with the right leading columns; EXPLAIN (with
sequential scans switched off, since test tables are tiny) proves the planner can
answer the real query shape from it.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from .conftest import requires_postgres, test_engine

pytestmark = requires_postgres

GHOST = "00000000-0000-4000-8000-000000000000"

INDEXES = {
    "ix_conversations_user_created": ("conversations", "(user_id, created_at)"),
    "ix_conversations_listener_status": ("conversations", "(listener_id, status)"),
    "ix_conversation_requests_target_status": (
        "conversation_requests",
        "(target_listener_id, status)",
    ),
    "ix_journal_entries_user_created": ("journal_entries", "(user_id, created_at)"),
}

# The shape of each surface's query (routers/conversation.py My Chats,
# listener_console.py console list + inbox, journals.py, services/in_touch.py).
QUERIES = {
    "ix_conversations_user_created": (
        f"SELECT id FROM conversations WHERE user_id = '{GHOST}' "
        "ORDER BY created_at DESC LIMIT 50"
    ),
    "ix_conversations_listener_status": (
        f"SELECT id FROM conversations WHERE listener_id = '{GHOST}' AND status = 'active'"
    ),
    "ix_conversation_requests_target_status": (
        f"SELECT id FROM conversation_requests WHERE target_listener_id = '{GHOST}' "
        "AND status = 'pending' ORDER BY created_at"
    ),
    "ix_journal_entries_user_created": (
        f"SELECT id FROM journal_entries WHERE user_id = '{GHOST}' "
        "ORDER BY created_at DESC LIMIT 50"
    ),
    # Deliberately not a new index: the partial unique index already answers every
    # live-link query (see migration d2b2ix000001).
    "uq_mentor_links_live_pair": (
        f"SELECT id FROM mentor_links WHERE user_id = '{GHOST}' "
        "AND status IN ('pending', 'accepted')"
    ),
}


@pytest.mark.parametrize("name", INDEXES)
def test_index_exists_with_the_right_columns(name):
    table, cols = INDEXES[name]
    with test_engine.connect() as conn:
        definition = conn.execute(
            text("SELECT indexdef FROM pg_indexes WHERE tablename = :t AND indexname = :n"),
            {"t": table, "n": name},
        ).scalar_one_or_none()
    assert definition is not None, f"{name} missing"
    assert definition.endswith(cols), definition


# The older single-column index on the same leading column. With tiny test tables the
# planner may prefer it plus a sort, depending on whether autovacuum has analyzed yet —
# so, inside a rolled-back transaction, it is dropped and sorts are switched off: the
# test then asks exactly "can this index answer this query shape", deterministically.
COMPETING = {
    "ix_conversations_user_created": "ix_conversations_user_id",
    "ix_conversations_listener_status": "ix_conversations_listener_id",
    "ix_conversation_requests_target_status": "ix_conversation_requests_status",
    "ix_journal_entries_user_created": "ix_journal_entries_user_id",
    "uq_mentor_links_live_pair": "ix_mentor_links_user_id",
}


@pytest.mark.parametrize("name", QUERIES)
def test_planner_uses_the_index_for_the_real_query(name):
    with test_engine.connect() as conn:
        for setting in ("enable_seqscan", "enable_sort", "enable_bitmapscan"):
            conn.execute(text(f"SET LOCAL {setting} = off"))
        if name in COMPETING:
            conn.execute(text(f"DROP INDEX {COMPETING[name]}"))
        plan = "\n".join(conn.execute(text(f"EXPLAIN {QUERIES[name]}")).scalars().all())
        conn.rollback()
    assert name in plan, plan
