"""Listener/mentor profile. In v1 chat, listeners appear as anonymous personas."""
from __future__ import annotations

from sqlalchemy import JSON, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import Gender, ListenerStatus, VettingStatus
from app.models.mixins import TimestampMixin, UUIDMixin


class ListenerProfile(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "listener_profiles"

    persona_name: Mapped[str] = mapped_column(String(64), index=True)
    persona_avatar: Mapped[str] = mapped_column(String(64))

    gender: Mapped[Gender] = mapped_column(default=Gender.undisclosed)
    # Issue categories this listener accepts (life/emotional-leaning in v1).
    categories: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Path (Communities): the road this listener has walked (upsc/neet/…).
    # Null = serves every community. Soft matching preference, never a hard filter.
    community_slug: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)

    status: Mapped[ListenerStatus] = mapped_column(default=ListenerStatus.offline, index=True)
    vetting_status: Mapped[VettingStatus] = mapped_column(default=VettingStatus.pending, index=True)

    # Non-cash reputation (PRD §9). Higher rank → higher match priority.
    rank: Mapped[int] = mapped_column(Integer, default=0)
    active_conversations: Mapped[int] = mapped_column(Integer, default=0)
    max_concurrent: Mapped[int] = mapped_column(Integer, default=3)
