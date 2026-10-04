"""Persist conversation transport ownership without enabling own-chat matching.

Revision ID: ea01chat0001
Revises: e9a1erase001
"""

import sqlalchemy as sa
from alembic import op

revision = "ea01chat0001"
down_revision = "e9a1erase001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The constant server default backfills existing rooms and remains in place
    # for an older application release running during blue/green overlap.
    op.add_column(
        "conversations",
        sa.Column("chat_backend", sa.String(16), nullable=False, server_default="stream"),
    )
    op.create_check_constraint(
        "ck_conversations_chat_backend", "conversations", "chat_backend IN ('stream', 'own')"
    )


def downgrade() -> None:
    # Dropping ownership while own rooms exist would silently send their users to
    # Stream. Application rollback should retain the additive schema instead.
    # Hold the DDL lock before checking so a concurrent own-room insert cannot
    # land between the ownership check and the column removal.
    op.get_bind().execute(sa.text("LOCK TABLE conversations IN ACCESS EXCLUSIVE MODE"))
    if op.get_bind().scalar(
        sa.text("SELECT EXISTS (SELECT 1 FROM conversations WHERE chat_backend = 'own')")
    ):
        raise RuntimeError("Preserve transport ownership while own-chat conversations exist")
    op.drop_constraint("ck_conversations_chat_backend", "conversations", type_="check")
    op.drop_column("conversations", "chat_backend")
