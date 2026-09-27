"""merge WS2 and WS3 migration heads

Both workstreams' first migration re-parented onto WS4's e4a1jobs0001
independently (two parallel cloud sessions, neither aware of the other),
producing two divergent chains from the same parent. No-op merge.

Revision ID: 0883df9ee828
Revises: d2b2ix000001, e3a5recv0001
Create Date: 2026-09-28
"""

from __future__ import annotations

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "0883df9ee828"
down_revision: str | tuple[str, ...] | None = ("d2b2ix000001", "e3a5recv0001")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
