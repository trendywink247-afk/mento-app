"""conversation snooze (board A10) and application available times (board A37)

Additive: two nullable columns, safe under a running app.
- conversations.snoozed_until — the mentor's "Snooze 24 h" (services/snooze.py).
- listener_applications.available_times — the A37 time-of-day chips, beside the
  existing single-choice `availability`. NULL for rows from older builds.

Revision ID: b9550a247866
Revises: 034abb526d75
Create Date: 2026-09-19 20:19:20.015148
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b9550a247866"
down_revision: str | None = "034abb526d75"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "conversations", sa.Column("snoozed_until", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("listener_applications", sa.Column("available_times", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("listener_applications", "available_times")
    op.drop_column("conversations", "snoozed_until")
