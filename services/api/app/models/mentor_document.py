"""A document a mentor uploads to be marked Mento Verified (founder, 2026-11-10).

The file itself is kept only while the team reads it: it is wiped the moment a decision is made (or
after 30 days unread). What stays is the fact — kind, size, status, who decided and when — never the
content."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin, UUIDMixin


class MentorDocument(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "mentor_documents"

    listener_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("listener_profiles.id", ondelete="CASCADE"), index=True
    )
    # id_card | posting_letter | result | other (services/verification.py)
    kind: Mapped[str] = mapped_column(String(24))
    content_type: Mapped[str] = mapped_column(String(32))
    size_bytes: Mapped[int] = mapped_column(Integer)
    # The file. NULL once decided or expired: the content is never kept past the review.
    content: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    # pending | approved | rejected | expired
    status: Mapped[str] = mapped_column(String(12), default="pending", index=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # A short reason shown to the mentor on a rejection (admin-written, never the document's words).
    decision_note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    content_deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
