"""product feedback (board A11): role, category, words, screen, app version - no author

Additive: one new table. It has no user / listener / conversation column on purpose
(models/feedback.py).

Revision ID: 034abb526d75
Revises: cf89dba30416
Create Date: 2026-09-19 17:02:24.939369
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "034abb526d75"
down_revision: str | None = "cf89dba30416"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "product_feedback",
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("screen", sa.String(length=64), nullable=True),
        sa.Column("app_version", sa.String(length=32), nullable=True),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_product_feedback_category"), "product_feedback", ["category"], unique=False
    )
    op.create_index(op.f("ix_product_feedback_role"), "product_feedback", ["role"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_product_feedback_role"), table_name="product_feedback")
    op.drop_index(op.f("ix_product_feedback_category"), table_name="product_feedback")
    op.drop_table("product_feedback")
