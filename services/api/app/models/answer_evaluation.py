"""Answer evaluations (DECISIONS T.8): a member sends photos of a written answer, a mentor returns
feedback. Behind `evaluations_enabled` (off); no money moves (payments_live is False).

The photos live only as long as they are useful: wiped 30 days after feedback, at once on
withdrawal or expiry, and with everything else on Clean Wipe. They are never in a backup
(ops/prod-backup.sh excludes answer_pages data, as M.7 does for chat rows)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin, UUIDMixin


class AnswerEvaluation(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "answer_evaluations"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # mains | essay (services/evaluations.py TARIFF)
    kind: Mapped[str] = mapped_column(String(8))
    # everyone | one. "one" names target_listener_id; "everyone" goes to Mentors and Mento Verified.
    audience: Mapped[str] = mapped_column(String(8))
    target_listener_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("listener_profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # The mentor who took it. NULL until claimed (or if that mentor is erased).
    listener_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("listener_profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    question: Mapped[str | None] = mapped_column(String(500), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # draft | open | claimed | returned | withdrawn | expired
    status: Mapped[str] = mapped_column(String(12), default="draft", index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    # What this evaluation would pay the mentor, by turnaround (a record; nothing is paid).
    payout_paise: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pages_wiped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AnswerPage(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "answer_pages"

    evaluation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("answer_evaluations.id", ondelete="CASCADE"), index=True
    )
    idx: Mapped[int] = mapped_column(Integer)
    content_type: Mapped[str] = mapped_column(String(16))
    size_bytes: Mapped[int] = mapped_column(Integer)
    # The photo with its metadata stripped. NULL once wiped.
    content: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
