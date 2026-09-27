"""users.terms_accepted_at + terms_version (WS3 T3.9)

Additive and nullable, safe under a running app. Existing members have no recorded
acceptance; the gate (terms_gate_enforced) ships off.

Revision ID: e3a9term0001
Revises: e3a7stat0001
Create Date: 2026-09-27 15:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e3a9term0001"
down_revision: str | None = "e3a7stat0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users", sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("users", sa.Column("terms_version", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "terms_version")
    op.drop_column("users", "terms_accepted_at")
