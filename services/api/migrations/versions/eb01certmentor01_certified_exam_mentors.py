"""Certified exam mentors (DECISIONS section O): a flag an admin sets, and the applicant's own words.

Revision ID: eb01certmentor01
Revises: ea01chat0001

Expand only. `certified_exam` defaults false, so every existing mentor stays a general
listener and the previous release's code is unaffected. `exam_credential` is what an
applicant says they hold for exam mentoring; the admin reads it and decides.
"""

import sqlalchemy as sa
from alembic import op

revision = "eb01certmentor01"
down_revision = "ea01chat0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "listener_profiles",
        sa.Column("certified_exam", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "listener_profiles", sa.Column("certified_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "listener_applications", sa.Column("exam_credential", sa.String(200), nullable=True)
    )


def downgrade() -> None:
    # Forward-only: an admin's certification decisions are records; application rollback
    # keeps the additive schema instead.
    pass
