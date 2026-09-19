"""Stay in touch (DECISIONS §L.6–7) — continuity by mutual consent, not by a stable name.

Mentor names rotate; a member may ASK a mentor of one of their conversations to stay in
touch, and the mentor answers yes / not now. An accepted link survives every rename:
the member sees the mentor's CURRENT name plus "first met as <name>".

`first_met_as` is a snapshot, deliberately: it is the one place an old name stays
alive, and a name held here is never issued to another mentor (§L.7) while the link is
pending or accepted.

At most one LIVE (pending / accepted) link per member–mentor pair — a partial unique
index makes a double tap harmless. Identity never lives here: two opaque ids and a
persona name (T&S #7).
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import LinkEndedBy, LinkStatus
from app.models.mixins import TimestampMixin, UUIDMixin


class MentorLink(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "mentor_links"
    __table_args__ = (
        Index(
            "uq_mentor_links_live_pair",
            "user_id",
            "listener_id",
            unique=True,
            postgresql_where=text("status IN ('pending', 'accepted')"),
            sqlite_where=text("status IN ('pending', 'accepted')"),
        ),
    )

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    listener_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("listener_profiles.id", ondelete="CASCADE"), index=True
    )
    # The conversation the ask was made from (the mentor's card opens it). No FK —
    # conversations carry none today (audit F20).
    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    status: Mapped[LinkStatus] = mapped_column(default=LinkStatus.pending, index=True)

    # The mentor's name when these two FIRST talked, and when that was.
    first_met_as: Mapped[str] = mapped_column(String(64))
    first_met_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_by: Mapped[LinkEndedBy | None] = mapped_column(nullable=True)


class ListenerNameHistory(UUIDMixin, Base):
    """Every name a mentor has carried, with the span it was theirs. Lets an ENDED
    conversation keep the name the member knew (rotation must not rewrite history,
    and must not hand the member tomorrow's name for a mentor they are not in touch
    with), and lets an active one say "first talked as"."""

    __tablename__ = "listener_name_history"
    __table_args__ = (Index("ix_listener_name_history_span", "listener_id", "valid_from"),)

    listener_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("listener_profiles.id", ondelete="CASCADE")
    )
    persona_name: Mapped[str] = mapped_column(String(64), index=True)
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
