"""A new-chat request (general → match; personal → directed at a listener)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, false
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import RequestKind, RequestStatus
from app.models.mixins import TimestampMixin, UUIDMixin


class ConversationRequest(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "conversation_requests"
    # A mentor's inbox: their pending Personal requests (T2.2).
    __table_args__ = (
        Index("ix_conversation_requests_target_status", "target_listener_id", "status"),
    )

    # One question offered to every certified mentor (DECISIONS section P.4): no target until
    # the first to accept takes it. `target_listener_id` is then set to that mentor.
    broadcast: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    kind: Mapped[RequestKind] = mapped_column(default=RequestKind.general)
    status: Mapped[RequestStatus] = mapped_column(default=RequestStatus.pending, index=True)

    requester_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    issue_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_listener_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("listener_profiles.id", ondelete="CASCADE"), nullable=True
    )
    intro_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # SET NULL: the request outlives a conversation deleted by a failed channel create.
    conversation_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )

    # When the 24-hour "no reply yet, what would you like to do?" nudge went out (§P.5).
    nudged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # When this question first appeared in the target mentor's console inbox — the only
    # honest "Seen" the member's letter (board A04) can light. Never set for a request
    # nobody has been shown.
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RequestPass(UUIDMixin, TimestampMixin, Base):
    """A mentor who passed on a broadcast request: it stays open for the others, and is no
    longer in this mentor's inbox."""

    __tablename__ = "request_passes"
    __table_args__ = (UniqueConstraint("request_id", "listener_id", name="uq_request_passes_pair"),)

    request_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversation_requests.id", ondelete="CASCADE")
    )
    listener_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("listener_profiles.id", ondelete="CASCADE"), index=True
    )
