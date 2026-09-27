"""member status, ban window, install hash; 'system' reporter kind (WS3 T3.7)

Additive and safe under a running app: `users.status` is NOT NULL with a server
default of 'active', so every existing member stays exactly as they are; the other
two columns are nullable. `reporterkind` gains 'system' for server-raised events.

Revision ID: e3a7stat0001
Revises: e3a10code0001
Create Date: 2026-09-27 14:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e3a7stat0001"
down_revision: str | None = "e3a10code0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    member_status = sa.Enum("active", "suspended", "banned", name="memberstatus")
    member_status.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "users",
        sa.Column("status", member_status, server_default="active", nullable=False),
    )
    op.add_column("users", sa.Column("banned_until", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("install_hash", sa.String(length=64), nullable=True))
    op.create_index(op.f("ix_users_install_hash"), "users", ["install_hash"], unique=False)
    op.execute("ALTER TYPE reporterkind ADD VALUE IF NOT EXISTS 'system'")


def downgrade() -> None:
    # Postgres cannot drop an enum value; 'system' stays on reporterkind.
    op.drop_index(op.f("ix_users_install_hash"), table_name="users")
    op.drop_column("users", "install_hash")
    op.drop_column("users", "banned_until")
    op.drop_column("users", "status")
    sa.Enum(name="memberstatus").drop(op.get_bind(), checkfirst=True)
