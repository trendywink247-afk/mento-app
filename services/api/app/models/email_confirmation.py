"""A pending email confirmation (DECISIONS R.10): one per member, the code stored hashed."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin


class EmailConfirmation(TimestampMixin, Base):
    __tablename__ = "email_confirmations"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # The address being confirmed; copied to users.email only when the code matches.
    email: Mapped[str] = mapped_column(String(255))
    # sha256 of the user id and the six-digit code; the code itself is never stored.
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
