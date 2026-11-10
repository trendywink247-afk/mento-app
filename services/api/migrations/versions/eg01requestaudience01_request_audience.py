"""Who a broadcast request is offered to (founder, 2026-11-10): any, in-service or peer.

Revision ID: eg01requestaudience01
Revises: ef01mentorlanguages01

Expand only: one column with a default, so every existing request reads as "any".
"""

import sqlalchemy as sa
from alembic import op

revision = "eg01requestaudience01"
down_revision = "ef01mentorlanguages01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversation_requests",
        sa.Column("audience", sa.String(length=16), nullable=False, server_default="any"),
    )


def downgrade() -> None:
    # Forward-only; application rollback keeps the additive column.
    pass
