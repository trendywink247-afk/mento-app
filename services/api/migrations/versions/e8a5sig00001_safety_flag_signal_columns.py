"""safety_flags.source + category + risk_score (WS8 T8.5)

Additive, safe under a running app: `source` has a server default, the other two are
nullable. Existing rows all came from the lexicon, so they are backfilled as such —
category = their signal, score = 1.0 (a lexicon hit is a hard match). Signal only:
none of the three columns can hold message text.

Revision ID: e8a5sig00001
Revises: 0883df9ee828
Create Date: 2026-09-27 18:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e8a5sig00001"
down_revision: str | None = "0883df9ee828"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "safety_flags",
        sa.Column("source", sa.String(length=16), server_default="lexicon", nullable=False),
    )
    op.add_column("safety_flags", sa.Column("category", sa.String(length=32), nullable=True))
    op.add_column("safety_flags", sa.Column("risk_score", sa.Float(), nullable=True))
    op.create_check_constraint(
        op.f("ck_safety_flags_risk_score_unit_range"),
        "safety_flags",
        "risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 1)",
    )
    op.execute(
        "UPDATE safety_flags SET category = signal::text, risk_score = 1.0 "
        "WHERE category IS NULL AND signal::text <> 'none'"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_safety_flags_risk_score_unit_range"), "safety_flags", type_="check")
    op.drop_column("safety_flags", "risk_score")
    op.drop_column("safety_flags", "category")
    op.drop_column("safety_flags", "source")
