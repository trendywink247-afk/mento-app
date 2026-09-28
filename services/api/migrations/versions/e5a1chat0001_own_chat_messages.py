"""own chat: chat_messages + chat_read_markers (WS5 T5.1)

From the spike (`spike/own-chat`, revision c0chat0spike1, never shipped) plus
`sender_kind`. New tables only — nothing reads or writes them until the own-chat
router is used, so this is safe under a running app.

Revision ID: e5a1chat0001
Revises: e8a5sig00001
Create Date: 2026-09-27 19:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5a1chat0001"
down_revision: str | None = "e8a5sig00001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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
    op.create_index(op.f("ix_chat_messages_conversation_id"), "chat_messages", ["conversation_id"])
    op.create_table(
        "chat_read_markers",
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("reader_id", sa.String(length=36), nullable=False),
        sa.Column("last_read_seq", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("conversation_id", "reader_id"),
    )


def downgrade() -> None:
    op.drop_table("chat_read_markers")
    op.drop_index(op.f("ix_chat_messages_conversation_id"), table_name="chat_messages")
    op.drop_table("chat_messages")
