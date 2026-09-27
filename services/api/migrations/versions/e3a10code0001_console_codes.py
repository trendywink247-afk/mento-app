"""console_codes: one-time, ten-minute mentor console codes (WS3 T3.10)

Additive: one new table, safe under a running app. Rows cascade with their
mentor profile.

Revision ID: e3a10code0001
Revises: e3a2sess0001
Create Date: 2026-09-27 13:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e3a10code0001"
down_revision: str | None = "e3a2sess0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "console_codes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("listener_id", sa.String(length=36), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["listener_id"], ["listener_profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code_hash"),
    )
    op.create_index(
        op.f("ix_console_codes_listener_id"), "console_codes", ["listener_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_console_codes_listener_id"), table_name="console_codes")
    op.drop_table("console_codes")
