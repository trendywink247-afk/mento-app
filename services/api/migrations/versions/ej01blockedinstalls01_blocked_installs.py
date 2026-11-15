"""The install of a blocked member who erased their account (founder, 2026-11-10).

Revision ID: ej01blockedinstalls01
Revises: ei01pushpreview01

Expand only: a new table (one-way install hash and an end date, nothing else).
"""

import sqlalchemy as sa
from alembic import op

revision = "ej01blockedinstalls01"
down_revision = "ei01pushpreview01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "blocked_installs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("install_hash", sa.String(length=64), nullable=False),
        sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_blocked_installs_install_hash", "blocked_installs", ["install_hash"])


def downgrade() -> None:
    # Forward-only; application rollback keeps the additive table.
    pass
