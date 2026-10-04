"""Recovery erasure receipts.

Revision ID: e9a1erase001
Revises: e5a6part0001
"""
import sqlalchemy as sa
from alembic import op

revision = "e9a1erase001"
down_revision = "e5a6part0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "erasure_receipts",
        sa.Column("member_digest", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("member_digest"),
    )


def downgrade() -> None:
    # Never silently discard receipts needed to prevent account resurrection.
    connection = op.get_bind()
    if connection.scalar(sa.text("SELECT count(*) FROM erasure_receipts")):
        raise RuntimeError("Preserve recovery receipts before downgrading this migration")
    op.drop_table("erasure_receipts")
