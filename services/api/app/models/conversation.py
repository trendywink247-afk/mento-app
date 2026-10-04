"""A 1:1 conversation with one server-selected owner for its message transport."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import ConversationEndedBy, ConversationStatus, ConversationType
from app.models.mixins import TimestampMixin, UUIDMixin


class Conversation(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "conversations"
    __table_args__ = (
        CheckConstraint("chat_backend IN ('stream', 'own')", name="ck_conversations_chat_backend"),
        # My Chats: a member's conversations, newest first (T2.2).
        Index("ix_conversations_user_created", "user_id", "created_at"),
        # Mentor console list and seat accounting: a mentor's conversations by status.
        Index("ix_conversations_listener_status", "listener_id", "status"),
    )

    type: Mapped[ConversationType] = mapped_column(default=ConversationType.anon)
    status: Mapped[ConversationStatus] = mapped_column(
        default=ConversationStatus.active, index=True
    )

    # Ownership is persisted, never selected by a client or inferred from channel ids.
    # Keep both defaults: older releases omit this column when inserting a room.
    # Matching continues to create Stream rooms until a separate accepted cutover.
    chat_backend: Mapped[str] = mapped_column(
        String(16), nullable=False, default="stream", server_default="stream"
    )

    # RESTRICT, both sides (T2.1): this row is the only handle on the Stream channel,
    # so a member or mentor delete must never take it implicitly — erasure ends and
    # wipes every conversation first (services/erasure.py), then deletes them.
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    listener_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("listener_profiles.id", ondelete="RESTRICT"), index=True
    )

    # Stream Chat channel id (cid). Source of truth for messages. Unique-indexed:
    # the crisis webhook resolves channel → conversation on every inbound message.
    stream_channel_id: Mapped[str | None] = mapped_column(
        String(128), nullable=True, unique=True, index=True
    )

    # Topic picked at match time (General's chip or Personal request's issue_category).
    # Server-data label lives in services/categories.py. Historic rows: NULL.
    issue_category: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # Per-conversation controls (simplified for v1; behind the options menu).
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    pin_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_paused: Mapped[bool] = mapped_column(Boolean, default=False)
    status_mask: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Message allowance (DECISIONS §L.2): member messages sent in a row since the
    # mentor last wrote. Bumped / reset ONLY by the Stream before-send hook
    # (services/allowance.py). A number, never content.
    member_streak: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    # Snooze 24 h (DECISIONS §L, founder 2026-09-19): the mentor's "I can't reply
    # today". While in the future: the chat sorts after un-snoozed ones in the
    # console, the mentor gets no message pushes for it, and the stale sweep leaves
    # it alone. A crisis-flagged member message, or the mentor's own reply, ends it
    # (services/snooze.py). Never hides a crisis.
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Who ended it: member (end/wipe/report/block), listener (mentor console End),
    # system (reconcile sweep). NULL for rows ended before this column existed.
    ended_by: Mapped[ConversationEndedBy | None] = mapped_column(nullable=True)
