"""Message likes and mentors' last seen (DECISIONS T.6, T.7).

Revision ID: em01v11likesseen01
Revises: el01mentortiers01

Expand only: a boolean with a server default on chat_messages (Postgres carries it to every
partition) and a nullable timestamp on listener_profiles. Safe under the previous release's code,
which never reads either.
"""

import sqlalchemy as sa
from alembic import op

revision = "em01v11likesseen01"
down_revision = "el01mentortiers01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "chat_messages",
        sa.Column("liked", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "listener_profiles",
        sa.Column("last_online_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("listener_profiles", "last_online_at")
    op.drop_column("chat_messages", "liked")
