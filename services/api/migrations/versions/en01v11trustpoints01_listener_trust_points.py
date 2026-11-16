"""Never-shown trust score from likes (DECISIONS T.8).

Revision ID: en01v11trustpoints01
Revises: em01v11likesseen01

Expand only: an integer with a server default on listener_profiles. The previous release's
code never reads it.
"""

import sqlalchemy as sa
from alembic import op

revision = "en01v11trustpoints01"
down_revision = "em01v11likesseen01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "listener_profiles",
        sa.Column("trust_points", sa.Integer(), server_default="0", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("listener_profiles", "trust_points")
