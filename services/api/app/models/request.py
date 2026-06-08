"""A new-chat request (general → match; personal → directed at a listener)."""
from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import RequestKind, RequestStatus
from app.models.mixins import TimestampMixin, UUIDMixin


class ConversationRequest(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "conversation_requests"

    kind: Mapped[RequestKind] = mapped_column(default=RequestKind.general)
    status: Mapped[RequestStatus] = mapped_column(default=RequestStatus.pending, index=True)

    requester_id: Mapped[str] = mapped_column(String(36), index=True)
    issue_category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    target_listener_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    intro_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
