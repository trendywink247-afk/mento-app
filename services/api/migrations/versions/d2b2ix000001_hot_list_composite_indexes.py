"""hot list composite indexes (T2.2)

My Chats, the mentor console list, the mentor inbox, journal lists and stay-in-touch
lookups all filter on an owner and then order or filter by a second column. A plain
CREATE INDEX blocks writes to the table while it builds — these tables are small today;
revisit with CREATE INDEX CONCURRENTLY (outside a transaction) once they are not.

Not added, though the task card lists it: mentor_links(user_id, status). Every live-link
query is already answered by the partial unique index uq_mentor_links_live_pair
(user_id, listener_id) WHERE status IN ('pending', 'accepted'); the one other query
reads a single member's few rows. It would only add write cost.

Revision ID: d2b2ix000001
Revises: d2a1fk000001
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d2b2ix000001"
down_revision: str | None = "d2a1fk000001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index(
        "ix_conversation_requests_target_status",
        "conversation_requests",
        ["target_listener_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_conversations_listener_status", "conversations", ["listener_id", "status"], unique=False
    )
    op.create_index(
        "ix_conversations_user_created", "conversations", ["user_id", "created_at"], unique=False
    )
    op.create_index(
        "ix_journal_entries_user_created",
        "journal_entries",
        ["user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_journal_entries_user_created", table_name="journal_entries")
    op.drop_index("ix_conversations_user_created", table_name="conversations")
    op.drop_index("ix_conversations_listener_status", table_name="conversations")
    op.drop_index("ix_conversation_requests_target_status", table_name="conversation_requests")
