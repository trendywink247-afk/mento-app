"""push token owner

Revision ID: 03397471ed9e
Revises: 2788b34bd299
Create Date: 2026-09-05 14:18:50.014372
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "03397471ed9e"
down_revision: str | None = "2788b34bd299"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    owner_kind = sa.Enum("member", "listener", name="pushownerkind")
    owner_kind.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "push_tokens",
        sa.Column("owner_kind", owner_kind, nullable=False, server_default="member"),
    )
    op.add_column("push_tokens", sa.Column("owner_id", sa.String(length=36), nullable=True))
    op.execute("UPDATE push_tokens SET owner_id = user_id WHERE owner_id IS NULL")
    op.alter_column("push_tokens", "owner_id", nullable=False)
    op.create_index("ix_push_tokens_owner", "push_tokens", ["owner_kind", "owner_id"])


def downgrade() -> None:
    op.drop_index("ix_push_tokens_owner", table_name="push_tokens")
    op.drop_column("push_tokens", "owner_id")
    op.drop_column("push_tokens", "owner_kind")
    sa.Enum(name="pushownerkind").drop(op.get_bind(), checkfirst=True)
