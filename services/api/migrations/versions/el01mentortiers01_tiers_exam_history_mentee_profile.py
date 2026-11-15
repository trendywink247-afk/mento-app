"""Three tiers, exam history, mentee profile, email confirmation (DECISIONS R.4-R.14).

Revision ID: el01mentortiers01
Revises: ek01requestinboxindex01

Expand only: nullable columns on listener_profiles and users, and two new tables. Safe under the
previous release's code (it never reads them).
"""

import sqlalchemy as sa
from alembic import op

revision = "el01mentortiers01"
down_revision = "ek01requestinboxindex01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("listener_profiles", sa.Column("tier", sa.String(length=16), nullable=True))
    op.add_column("listener_profiles", sa.Column("exam_history", sa.JSON(), nullable=True))
    op.add_column(
        "listener_profiles",
        sa.Column("exam_history_checked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "mentee_profiles",
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column(
            "marks_visibility", sa.String(length=16), server_default="mentors", nullable=False
        ),
    )
    op.add_column(
        "users", sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_table(
        "email_confirmations",
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempts", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_table("email_confirmations")
    op.drop_column("users", "email_verified_at")
    op.drop_table("mentee_profiles")
    op.drop_column("listener_profiles", "exam_history_checked_at")
    op.drop_column("listener_profiles", "exam_history")
    op.drop_column("listener_profiles", "tier")
