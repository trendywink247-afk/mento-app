"""Documents a mentor uploads to become Mento Verified (founder, 2026-11-10).

Revision ID: eh01mentordocuments01
Revises: eg01requestaudience01

Expand only: a new table. The file bytes are wiped when a decision is made.
"""

import sqlalchemy as sa
from alembic import op

revision = "eh01mentordocuments01"
down_revision = "eg01requestaudience01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mentor_documents",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "listener_id",
            sa.String(length=36),
            sa.ForeignKey("listener_profiles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=24), nullable=False),
        sa.Column("content_type", sa.String(length=32), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=True),
        sa.Column("status", sa.String(length=12), nullable=False, server_default="pending"),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", sa.String(length=36), nullable=True),
        sa.Column("decision_note", sa.String(length=200), nullable=True),
        sa.Column("content_deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_mentor_documents_listener_id", "mentor_documents", ["listener_id"])
    op.create_index("ix_mentor_documents_status", "mentor_documents", ["status"])


def downgrade() -> None:
    # Forward-only; application rollback keeps the additive table.
    pass
