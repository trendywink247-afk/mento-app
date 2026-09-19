"""user companion name (founder ruling 2026-09-19: name your companion on the pick)

Additive: one nullable column, safe under a running app.
- users.companion_name — the member's own name for their growth companion. Only the
  member ever reads it back (GET /me); it never reaches a mentor, Stream, analytics or
  the admin dashboard (tests/test_companion_name.py). Validated in services/companions.

Revision ID: 3a56447b2ab6
Revises: 9c5ada714a88
Create Date: 2026-09-19 22:10:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3a56447b2ab6"
down_revision: str | None = "9c5ada714a88"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("companion_name", sa.String(length=24), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "companion_name")
