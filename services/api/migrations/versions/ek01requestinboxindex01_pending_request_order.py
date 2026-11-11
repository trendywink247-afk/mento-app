"""Partial index for the mentor request inbox (performance review, 2026-11-11).

Revision ID: ek01requestinboxindex01
Revises: ej01blockedinstalls01

Expand only: one additive partial index over the pending rows, built CONCURRENTLY outside
the migration transaction so writes are never blocked. The previous release's code ignores it.
"""

from alembic import op

revision = "ek01requestinboxindex01"
down_revision = "ej01blockedinstalls01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.create_index(
            "ix_conversation_requests_pending_order",
            "conversation_requests",
            ["created_at", "id"],
            postgresql_where="status = 'pending'",
            postgresql_concurrently=True,
            if_not_exists=True,
        )


def downgrade() -> None:
    # Forward-only; application rollback keeps the additive index.
    pass
