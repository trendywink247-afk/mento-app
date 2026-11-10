"""Whether a person wants the text of a message shown in its notification (founder, 2026-11-10).

Revision ID: ei01pushpreview01
Revises: eh01mentordocuments01

Expand only: one boolean on users and one on listener_profiles, both off by default.
"""

import sqlalchemy as sa
from alembic import op

revision = "ei01pushpreview01"
down_revision = "eh01mentordocuments01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("users", "listener_profiles"):
        op.add_column(
            table,
            sa.Column("push_preview", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    # Forward-only; application rollback keeps the additive columns.
    pass
