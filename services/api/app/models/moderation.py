"""Moderation events (PRD §11). Report/Block files one of these."""
from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import ModerationLevel
from app.models.mixins import TimestampMixin, UUIDMixin


class ModerationEvent(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "moderation_events"

    reporter_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    subject_id: Mapped[str] = mapped_column(String(36), index=True)  # reported user/listener
    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    level: Mapped[ModerationLevel] = mapped_column(default=ModerationLevel.warning)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    blocked: Mapped[bool] = mapped_column(default=False)
