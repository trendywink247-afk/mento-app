"""End-of-conversation reflection (PRD §6, SCOPE §8).

Deliberately minimal: the energy value (1 = left drained … 5 = left energized) keyed
by conversation only — no user_id column, no message content, no points/XP. Ownership
is checked at the endpoint and then dropped, so the stored row can't be joined back
to a person without going through the conversation table (and never feeds engagement
dashboards — T&S #5/#10).
"""
from __future__ import annotations

from sqlalchemy import Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin, UUIDMixin


class ConversationReflection(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "conversation_reflections"
    __table_args__ = (UniqueConstraint("conversation_id", name="uq_reflection_conversation"),)

    conversation_id: Mapped[str] = mapped_column(String(36), index=True)
    energy: Mapped[int] = mapped_column(Integer)  # 1 (drained) … 5 (energized)
