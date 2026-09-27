"""Journal entries. Fed by the AI Journal Assistant and save-to-journal from chat."""

from __future__ import annotations

from sqlalchemy import JSON, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import JournalChannel
from app.models.mixins import TimestampMixin, UUIDMixin


class JournalEntry(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "journal_entries"
    # Every journal list: a member's entries, newest first (T2.2).
    __table_args__ = (Index("ix_journal_entries_user_created", "user_id", "created_at"),)

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    channel: Mapped[JournalChannel] = mapped_column(index=True)
    body: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(24), default="manual")  # manual|chat|ai|notif
    # Channel-specific structured payload (e.g. finance: {amount_paise, category}).
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
