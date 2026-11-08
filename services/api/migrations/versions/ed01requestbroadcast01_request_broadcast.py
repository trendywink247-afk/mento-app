"""Broadcast requests (DECISIONS section P.4): one question offered to every certified mentor.

Revision ID: ed01requestbroadcast01
Revises: ec01mentorinvite01

Expand only: a boolean with a default on conversation_requests, and one new table that records
the mentors who passed on a broadcast (so it stays open for the others).
"""

import sqlalchemy as sa
from alembic import op

revision = "ed01requestbroadcast01"
down_revision = "ec01mentorinvite01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversation_requests",
        sa.Column("broadcast", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "request_passes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "request_id",
            sa.String(36),
            sa.ForeignKey("conversation_requests.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "listener_id",
            sa.String(36),
            sa.ForeignKey("listener_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.UniqueConstraint("request_id", "listener_id", name="uq_request_passes_pair"),
    )
    op.create_index("ix_request_passes_listener_id", "request_passes", ["listener_id"])


def downgrade() -> None:
    # Forward-only; application rollback leaves the unused column and table.
    pass
