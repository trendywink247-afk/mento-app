"""member erasure detaches safety records (DELETE /me, DECISIONS §L.11)

Two NOT NULL → NULL relaxations, safe under a running app (no rewrite, no default):
- safety_flags.user_id — an erased member's crisis flags stay for safety review
  (signal only, never a body) but no longer point at a person.
- moderation_events.subject_id — a mentor's report about a member who has since erased
  their account stays in the review queue without the member's id.

Downgrade refuses nothing but will fail if any NULL rows exist (erased members) —
by design: re-attaching an erased person is not possible.

Revision ID: 9c5ada714a88
Revises: b9550a247866
Create Date: 2026-09-19 21:44:07.317189
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9c5ada714a88"
down_revision: str | None = "b9550a247866"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "moderation_events", "subject_id", existing_type=sa.VARCHAR(length=36), nullable=True
    )
    op.alter_column("safety_flags", "user_id", existing_type=sa.VARCHAR(length=36), nullable=True)


def downgrade() -> None:
    op.alter_column("safety_flags", "user_id", existing_type=sa.VARCHAR(length=36), nullable=False)
    op.alter_column(
        "moderation_events", "subject_id", existing_type=sa.VARCHAR(length=36), nullable=False
    )
