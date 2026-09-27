"""Moderation events (PRD §11). Report/Block files one of these."""

from __future__ import annotations

from sqlalchemy import Boolean, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import ModerationLevel, ReporterKind
from app.models.mixins import TimestampMixin, UUIDMixin


class ModerationEvent(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "moderation_events"
    # The never-rematch block list filters on (reporter_id, blocked) for every match.
    __table_args__ = (Index("ix_moderation_events_reporter_blocked", "reporter_id", "blocked"),)

    reporter_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Who filed it. `reporter_id` is a User id for members and a ListenerProfile id
    # for listeners; the block-list query only ever reads member rows (blocked=True).
    # Polymorphic, so no plain FK: Postgres triggers (migration d2a1fk000001) reject a
    # reporter that does not exist for its kind, and NULL it when that row is deleted.
    # `subject_id` and `conversation_id` stay unkeyed by design — a report outlives
    # both the reported member's erasure and the conversation it came from.
    reporter_kind: Mapped[ReporterKind] = mapped_column(default=ReporterKind.member)
    # The reported user or listener. NULL once a reported MEMBER has erased their account
    # (DELETE /me): a mentor's report stays for review, the member's id does not.
    subject_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    level: Mapped[ModerationLevel] = mapped_column(default=ModerationLevel.warning)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    blocked: Mapped[bool] = mapped_column(default=False)

    # Human review (PRD §11). Reports land here as unreviewed until a reviewer resolves
    # them — surfaced, not just stored. (Full moderation console is Module C.)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
