"""hot-path indexes: channel lookup, safety dedupe, block-list

Revision ID: c7a91f4d2b58
Revises: 5e070c058a36
Create Date: 2026-07-13
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c7a91f4d2b58'
down_revision: Union[str, None] = '5e070c058a36'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Every inbound message resolves channel → conversation in the webhook hot
    # path; without this it's a sequential scan growing with lifetime conversations.
    # Unique by construction (ids are minted from uuid4).
    op.create_index(
        op.f('ix_conversations_stream_channel_id'),
        'conversations',
        ['stream_channel_id'],
        unique=True,
    )
    # Make the sync-hook/async-net dedupe race-proof: check-then-insert alone can
    # double-insert; scan_and_flag now treats the unique violation as "already
    # flagged". (Postgres unique indexes permit multiple NULLs, so flags raised
    # outside Stream are unaffected.)
    op.drop_index(op.f('ix_safety_flags_stream_message_id'), table_name='safety_flags')
    op.create_index(
        op.f('ix_safety_flags_stream_message_id'),
        'safety_flags',
        ['stream_message_id'],
        unique=True,
    )
    # The never-rematch block list is consulted on every match, listener list, and
    # personal request; only subject_id was indexed.
    op.create_index(
        op.f('ix_moderation_events_reporter_blocked'),
        'moderation_events',
        ['reporter_id', 'blocked'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_moderation_events_reporter_blocked'), table_name='moderation_events')
    op.drop_index(op.f('ix_safety_flags_stream_message_id'), table_name='safety_flags')
    op.create_index(
        op.f('ix_safety_flags_stream_message_id'),
        'safety_flags',
        ['stream_message_id'],
        unique=False,
    )
    op.drop_index(op.f('ix_conversations_stream_channel_id'), table_name='conversations')
