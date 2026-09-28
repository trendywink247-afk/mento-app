"""chat_messages: monthly range partitions + encrypted bodies (WS5 T5.6)

Replaces the T5.1 table (never deployed) with one partitioned by RANGE (created_at):
a default partition plus this month and the next two (app/jobs/retention.py keeps them
ahead and drops expired ones). `body` becomes AES-256-GCM ciphertext (bytea) with its
`key_id` (services/message_crypto.py). The primary key must include the partition key,
so it is (id, created_at), and the per-conversation seq / client_id uniques become plain
indexes — the conversation row lock in chat.persist_message is the guarantee.

Refuses to run if the old table holds rows: they would be plaintext, and this migration
does not hold the key to encrypt them or the right to drop them.

Revision ID: e5a6part0001
Revises: e5a1chat0001
Create Date: 2026-09-28 01:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from app.jobs.retention import ensure_partitions

# revision identifiers, used by Alembic.
revision: str = "e5a6part0001"
down_revision: str | None = "e5a1chat0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    conn = op.get_bind()
    leftover = conn.execute(sa.text("SELECT count(*) FROM chat_messages")).scalar_one()
    if leftover:
        raise RuntimeError(
            f"chat_messages holds {leftover} plaintext row(s) from before encryption — "
            "refusing to convert. They can only come from a dev/test database: "
            "TRUNCATE chat_messages there and re-run."
        )
    op.drop_index("ix_chat_messages_conversation_id", table_name="chat_messages")
    op.drop_table("chat_messages")
    op.create_table(
        "chat_messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("sender_kind", sa.String(length=8), nullable=False),
        sa.Column("sender_id", sa.String(length=36), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("body", sa.LargeBinary(), nullable=False),
        sa.Column("key_id", sa.String(length=16), nullable=False),
        sa.Column("crisis_signal", sa.String(length=32), nullable=True),
        sa.Column("redacted", sa.Boolean(), server_default="false", nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", "created_at"),
        postgresql_partition_by="RANGE (created_at)",
    )
    op.create_index(
        "ix_chat_messages_conversation_seq", "chat_messages", ["conversation_id", "seq"]
    )
    op.create_index(
        "ix_chat_messages_client_id",
        "chat_messages",
        ["conversation_id", "sender_id", "client_id"],
    )
    ensure_partitions(conn)


def downgrade() -> None:
    # Forward-only in practice (CLAUDE.md); this restores the T5.1 shape, empty.
    op.drop_table("chat_messages")  # drops every partition with it
    op.create_table(
        "chat_messages",
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("sender_kind", sa.String(length=8), nullable=False),
        sa.Column("sender_id", sa.String(length=36), nullable=False),
        sa.Column("seq", sa.BigInteger(), nullable=False),
        sa.Column("client_id", sa.String(length=64), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("crisis_signal", sa.String(length=32), nullable=True),
        sa.Column("redacted", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "conversation_id", "sender_id", "client_id", name="uq_chat_messages_client_id"
        ),
        sa.UniqueConstraint("conversation_id", "seq", name="uq_chat_messages_conversation_seq"),
    )
    op.create_index("ix_chat_messages_conversation_id", "chat_messages", ["conversation_id"])
