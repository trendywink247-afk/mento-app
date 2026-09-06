"""A member's saved mentors (spec 2026-09-06 §3.4). Affects Browse ordering only —
no matcher preference, no "favourites" filter in v1. Cascades on either side: Start
Fresh / account wipe removes the member's rows, and a removed listener profile
removes any rows pointing at it.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class FavouriteListener(Base):
    __tablename__ = "favourite_listeners"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    listener_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("listener_profiles.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
