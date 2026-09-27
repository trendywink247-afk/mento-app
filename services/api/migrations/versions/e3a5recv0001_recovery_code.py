"""users.recovery_selector + recovery_hash (WS3 T3.5)

Additive and nullable, safe under a running app. The selector is unique (it is how a
code finds its member); the hash is argon2id of the code's secret half.

Revision ID: e3a5recv0001
Revises: e3a9term0001
Create Date: 2026-09-27 16:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e3a5recv0001"
down_revision: str | None = "e3a9term0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("recovery_selector", sa.String(length=8), nullable=True))
    op.add_column("users", sa.Column("recovery_hash", sa.String(length=255), nullable=True))
    op.create_unique_constraint(op.f("uq_users_recovery_selector"), "users", ["recovery_selector"])


def downgrade() -> None:
    op.drop_constraint(op.f("uq_users_recovery_selector"), "users", type_="unique")
    op.drop_column("users", "recovery_hash")
    op.drop_column("users", "recovery_selector")
