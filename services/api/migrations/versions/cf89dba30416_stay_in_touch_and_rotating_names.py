"""stay in touch + rotating mentor names (DECISIONS L.6, L.7)

Additive and safe under a running app: two new tables, two columns on
listener_profiles (one nullable, one NOT NULL with a constant server default). Every
mentor's current name is written into the history as their first span, so a
conversation that ended before today keeps the name the member knew.

Revision ID: cf89dba30416
Revises: 8c6073da268d
Create Date: 2026-09-19 16:43:26.600788
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cf89dba30416"
down_revision: str | None = "8c6073da268d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "listener_name_history",
        sa.Column("listener_id", sa.String(length=36), nullable=False),
        sa.Column("persona_name", sa.String(length=64), nullable=False),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(["listener_id"], ["listener_profiles.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_listener_name_history_persona_name"),
        "listener_name_history",
        ["persona_name"],
        unique=False,
    )
    op.create_index(
        "ix_listener_name_history_span",
        "listener_name_history",
        ["listener_id", "valid_from"],
        unique=False,
    )
    op.create_table(
        "mentor_links",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("listener_id", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=True),
        sa.Column(
            "status",
            sa.Enum("pending", "accepted", "declined", "withdrawn", "ended", name="linkstatus"),
            nullable=False,
        ),
        sa.Column("first_met_as", sa.String(length=64), nullable=False),
        sa.Column("first_met_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "ended_by", sa.Enum("member", "listener", "system", name="linkendedby"), nullable=True
        ),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["listener_id"], ["listener_profiles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_mentor_links_listener_id"), "mentor_links", ["listener_id"], unique=False
    )
    op.create_index(op.f("ix_mentor_links_status"), "mentor_links", ["status"], unique=False)
    op.create_index(op.f("ix_mentor_links_user_id"), "mentor_links", ["user_id"], unique=False)
    op.create_index(
        "uq_mentor_links_live_pair",
        "mentor_links",
        ["user_id", "listener_id"],
        unique=True,
        postgresql_where=sa.text("status IN ('pending', 'accepted')"),
        sqlite_where=sa.text("status IN ('pending', 'accepted')"),
    )
    op.add_column("listener_profiles", sa.Column("persona_name_day", sa.Date(), nullable=True))
    op.add_column(
        "listener_profiles",
        sa.Column("persona_stream_synced", sa.Boolean(), server_default="true", nullable=False),
    )

    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            """
            INSERT INTO listener_name_history (id, listener_id, persona_name, valid_from, valid_to)
            SELECT gen_random_uuid()::text, id, persona_name, created_at, NULL
            FROM listener_profiles
            """
        )


def downgrade() -> None:
    op.drop_column("listener_profiles", "persona_stream_synced")
    op.drop_column("listener_profiles", "persona_name_day")
    op.drop_index(
        "uq_mentor_links_live_pair",
        table_name="mentor_links",
        postgresql_where=sa.text("status IN ('pending', 'accepted')"),
        sqlite_where=sa.text("status IN ('pending', 'accepted')"),
    )
    op.drop_index(op.f("ix_mentor_links_user_id"), table_name="mentor_links")
    op.drop_index(op.f("ix_mentor_links_status"), table_name="mentor_links")
    op.drop_index(op.f("ix_mentor_links_listener_id"), table_name="mentor_links")
    op.drop_table("mentor_links")
    op.drop_index("ix_listener_name_history_span", table_name="listener_name_history")
    op.drop_index(op.f("ix_listener_name_history_persona_name"), table_name="listener_name_history")
    op.drop_table("listener_name_history")
    # Postgres keeps enum types after their table is gone.
    sa.Enum(name="linkstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="linkendedby").drop(op.get_bind(), checkfirst=True)
