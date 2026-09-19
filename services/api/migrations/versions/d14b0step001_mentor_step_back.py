"""mentor step-back request: two nullable columns on listener_profiles (lane u14)

A live mentor who wants to Start fresh asks the team to step their mentor side back
(POST /listener-applications/me/step-back, board A32 / capture 409). Additive and nullable,
safe under a running app.

Revision ID: d14b0step001
Revises: d14a0owl0001
Create Date: 2026-09-20 13:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d14b0step001"
down_revision: str | None = "d14a0owl0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "listener_profiles",
        sa.Column("step_back_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "listener_profiles",
        sa.Column("step_back_reason", sa.String(length=280), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("listener_profiles", "step_back_reason")
    op.drop_column("listener_profiles", "step_back_requested_at")
