"""the letter's Seen is real: when the mentor's inbox showed them the question

Additive: one nullable timestamp on conversation_requests, safe under a running app.
- conversation_requests.seen_at — stamped the first time the question appears in the
  mentor's own console inbox (`GET /listener/me/requests`). The member's letter (board A04)
  lights "Seen" from it instead of guessing.

Revision ID: c13a0seen001
Revises: 4b971bd4faaa
Create Date: 2026-09-20 12:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c13a0seen001"
down_revision: str | None = "d14b0step001"  # chained after lane u14 (Owls, step back) at merge
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "conversation_requests",
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("conversation_requests", "seen_at")
