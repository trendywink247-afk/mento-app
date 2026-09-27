"""data requests register (T2.7) — kind, status, deadlines; no identity by design

A new table only: safe under a running app.

Revision ID: bed9ccc9474a
Revises: e4a1jobs0001
Create Date: 2026-09-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "bed9ccc9474a"
down_revision: str | None = "e4a1jobs0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

KIND = sa.Enum("access", "correction", "erasure", "grievance", name="datarequestkind")
STATUS = sa.Enum("open", "in_progress", "closed", name="datarequeststatus")


def upgrade() -> None:
    op.create_table(
        "data_requests",
        sa.Column("kind", KIND, nullable=False),
        sa.Column("status", STATUS, nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_data_requests_due_at"), "data_requests", ["due_at"], unique=False)
    op.create_index(op.f("ix_data_requests_kind"), "data_requests", ["kind"], unique=False)
    op.create_index(op.f("ix_data_requests_status"), "data_requests", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_data_requests_status"), table_name="data_requests")
    op.drop_index(op.f("ix_data_requests_kind"), table_name="data_requests")
    op.drop_index(op.f("ix_data_requests_due_at"), table_name="data_requests")
    op.drop_table("data_requests")
    STATUS.drop(op.get_bind(), checkfirst=True)
    KIND.drop(op.get_bind(), checkfirst=True)
