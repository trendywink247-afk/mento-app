"""A 1:1 conversation. Message bodies live in Stream Chat, not here (metadata only)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import ConversationStatus, ConversationType
from app.models.mixins import TimestampMixin, UUIDMixin


class Conversation(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "conversations"

    type: Mapped[ConversationType] = mapped_column(default=ConversationType.anon)
    status: Mapped[ConversationStatus] = mapped_column(
        default=ConversationStatus.active, index=True
    )

    user_id: Mapped[str] = mapped_column(String(36), index=True)
    listener_id: Mapped[str] = mapped_column(String(36), index=True)

    # Stream Chat channel id (cid). Source of truth for messages.
    stream_channel_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Per-conversation controls (simplified for v1; behind the options menu).
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    pin_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_paused: Mapped[bool] = mapped_column(Boolean, default=False)
    status_mask: Mapped[str | None] = mapped_column(String(32), nullable=True)

    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
