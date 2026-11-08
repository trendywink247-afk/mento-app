"""A mentor's suggestion that a conversation moves to a certified exam mentor (DECISIONS section O).

Revision ID: eb02examredirect01
Revises: eb01certmentor01

Expand only: one nullable timestamp. It is a flag and a time, never text.
"""

import sqlalchemy as sa
from alembic import op

revision = "eb02examredirect01"
down_revision = "eb01certmentor01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations", sa.Column("exam_redirect_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    # Forward-only; application rollback keeps the additive column.
    pass
