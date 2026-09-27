"""A new-chat request (general → match; personal → directed at a listener)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import RequestKind, RequestStatus
from app.models.mixins import TimestampMixin, UUIDMixin


class ConversationRequest(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "conversation_requests"

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

    # When this question first appeared in the target mentor's console inbox — the only
    # honest "Seen" the member's letter (board A04) can light. Never set for a request
    # nobody has been shown.
    seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
