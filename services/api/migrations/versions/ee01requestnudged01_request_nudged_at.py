"""When a still-unanswered request was first nudged (DECISIONS section P.5).

Revision ID: ee01requestnudged01
Revises: ed01requestbroadcast01

Expand only: one nullable timestamp.
"""

import sqlalchemy as sa
from alembic import op

revision = "ee01requestnudged01"
down_revision = "ed01requestbroadcast01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversation_requests", sa.Column("nudged_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    # Forward-only; application rollback keeps the additive column.
    pass
