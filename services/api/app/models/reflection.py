"""End-of-conversation reflection (PRD §6, SCOPE §8).

Deliberately minimal: the energy value (1 = left drained … 5 = left energized) keyed
by conversation only — no user_id column, no message content, no points/XP.

Honest privacy statement: this is pseudonymous, NOT anonymous. The row carries
conversation_id, and conversations.user_id is one join away — anyone with DB access
can re-link a reflection to a persona. True unlinkability would mean dropping the
conversation key, which kills idempotency (re-submit updates the single row) and
per-conversation analytics. Trade-off recorded in PROGRESS.md → Open decisions;
until ratified, never describe reflections as unlinkable in user-facing copy, and
keep them out of engagement dashboards (T&S #5/#10).
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
