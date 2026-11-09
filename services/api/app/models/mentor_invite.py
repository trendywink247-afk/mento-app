"""Invitations to be a gold ("Mento verified") mentor (DECISIONS section P.2-3).

The founder hands a vetted person a single-use code. No email address or name is stored: only
a SHA-256 of the code (80 random bits, rate-limited at redemption), an optional short admin
note, and when it was claimed. Claiming turns the member's own anonymous account into a
certified mentor; the member's recovery code then restores that role on a new phone.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin, UUIDMixin


class MentorInvite(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "mentor_invites"

    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # An admin's private reminder of who this is for. Never shown to the mentor or a member.
    note: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    claimed_by: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    listener_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("listener_profiles.id", ondelete="SET NULL"), nullable=True
    )
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
