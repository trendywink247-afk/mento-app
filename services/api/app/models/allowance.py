"""Message allowance ledger (DECISIONS §L.2) — numbers only, never content.

One row per member per IST day. It is both the enforcement counter (10 a day) and
the source of the admin counts, so the two can never disagree. The 3-in-a-row streak
lives on the conversation (`conversations.member_streak`) because it is a property of
one thread, not of the member's day.

Privacy: the row says how MANY messages a member sent on a day — no text, no message
ids, no conversation ids. A member's rows older than `RETENTION_DAYS` are removed the
next time that member writes.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin

RETENTION_DAYS = 35


class MessageAllowanceDay(TimestampMixin, Base):
    __tablename__ = "message_allowance_days"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # The IST calendar day the counts belong to (the product's home timezone).
    day: Mapped[date] = mapped_column(Date, primary_key=True, index=True)

    # Member messages delivered AND counted against the day.
    sent: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Delivered without being counted: the scan flagged the message, or the
    # conversation carried a recent crisis flag.
    crisis_exempt: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Times a message was held by each rule (only while holding is switched on).
    row_cap_hits: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    day_cap_hits: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # The member's counted sends reached the daily limit in force on that day.
    reached_day_cap: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
