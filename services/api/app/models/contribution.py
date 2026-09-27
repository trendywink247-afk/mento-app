"""Contribution ("coffee"). Transparent, opt-in. Supports the TEAM, not the listener."""

from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin, UUIDMixin


class Contribution(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "contributions"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    amount_paise: Mapped[int] = mapped_column(Integer)  # store minor units
    razorpay_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    razorpay_payment_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="created")  # created|paid|failed
    # Plain label, audited (PRD §8.4): this supports the platform/team.
    label: Mapped[str] = mapped_column(String(64), default="support_team")
