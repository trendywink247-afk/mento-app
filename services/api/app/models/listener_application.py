"""Listener application (spec 2026-07-24). A member's ask to become a peer
listener. Anonymous by design: tied to the persona/user id, no real names.
`decline_reason` is admin-internal and must never appear in member payloads."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import ApplicationStatus
from app.models.mixins import TimestampMixin, UUIDMixin


class ListenerApplication(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "listener_applications"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    motivation: Mapped[str] = mapped_column(Text)
    # Path lenses the applicant has walked (upsc/neet/jee/exams/life).
    communities: Mapped[list[str]] = mapped_column(JSON, default=list)
    availability: Mapped[str] = mapped_column(String(32))
    # Times of day the applicant is usually free (board A37 chips; DECISIONS §L,
    # founder-delegated 2026-09-19) — additive beside the single-choice commitment
    # above. NULL for rows from builds that never sent it.
    available_times: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    # Optional; stored for the day we can send the console link by email.
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Module B staging: interest flag only, nothing else of Module B ships.
    mentor_interest: Mapped[bool] = mapped_column(Boolean, default=False)

    status: Mapped[ApplicationStatus] = mapped_column(default=ApplicationStatus.pending, index=True)
    decline_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Set on approval — the ListenerProfile this application became.
    listener_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("listener_profiles.id", ondelete="SET NULL"), nullable=True
    )
    pledge_accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
