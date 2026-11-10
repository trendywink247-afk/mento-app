"""The languages a mentor talks in (founder, 2026-11-10).

Revision ID: ef01mentorlanguages01
Revises: ee01requestnudged01

Expand only: a JSON list on the mentor profile (default empty) and an optional one on the application.
"""

import sqlalchemy as sa
from alembic import op

revision = "ef01mentorlanguages01"
down_revision = "ee01requestnudged01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "listener_profiles",
        sa.Column("languages", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.add_column("listener_applications", sa.Column("languages", sa.JSON(), nullable=True))


def downgrade() -> None:
    # Forward-only; application rollback keeps the additive columns.
    pass
