"""Gold mentor invitations (DECISIONS section P.2-3).

Revision ID: ec01mentorinvite01
Revises: eb02examredirect01

Expand only: one new table. Holds a hash of a single-use code and an optional admin note;
no email address, no name.
"""

import sqlalchemy as sa
from alembic import op

revision = "ec01mentorinvite01"
down_revision = "eb02examredirect01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mentor_invites",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("code_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("note", sa.String(80), nullable=True),
        sa.Column("created_by", sa.String(36), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_by", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column(
            "listener_id", sa.String(36), sa.ForeignKey("listener_profiles.id", ondelete="SET NULL")
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    # Forward-only; application rollback leaves the unused table.
    pass
