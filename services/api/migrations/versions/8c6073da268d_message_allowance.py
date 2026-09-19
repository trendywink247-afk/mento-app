"""message allowance (DECISIONS L.2): per-member IST-day ledger + per-conversation streak

Additive and safe under a running app: a new table, and one NOT NULL column with a
constant server default (no table rewrite on Postgres 11+; old code that inserts a
conversation without it gets 0).

Revision ID: 8c6073da268d
Revises: 61e06b08d4df
Create Date: 2026-09-19 16:32:41.402031
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8c6073da268d"
down_revision: str | None = "61e06b08d4df"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "message_allowance_days",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("sent", sa.Integer(), server_default="0", nullable=False),
        sa.Column("crisis_exempt", sa.Integer(), server_default="0", nullable=False),
        sa.Column("row_cap_hits", sa.Integer(), server_default="0", nullable=False),
        sa.Column("day_cap_hits", sa.Integer(), server_default="0", nullable=False),
        sa.Column("reached_day_cap", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id", "day"),
    )
    op.create_index(
        op.f("ix_message_allowance_days_day"), "message_allowance_days", ["day"], unique=False
    )
    op.add_column(
        "conversations",
        sa.Column("member_streak", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("conversations", "member_streak")
    op.drop_index(op.f("ix_message_allowance_days_day"), table_name="message_allowance_days")
    op.drop_table("message_allowance_days")
