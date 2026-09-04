"""Expo push tokens — device registration for remote push.

Tied only to the anonymous user id, never real identity (T&S: anonymity
integrity). Unique on the token value (not user_id) so a device reinstall
that lands on a new anonymous user re-points the same token instead of
leaving stale duplicate rows.
"""

from __future__ import annotations

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin, UUIDMixin


class PushToken(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "push_tokens"
    __table_args__ = (UniqueConstraint("expo_push_token", name="uq_push_token_value"),)

    user_id: Mapped[str] = mapped_column(String(36), index=True)
    expo_push_token: Mapped[str] = mapped_column(String(255), index=True)
    platform: Mapped[str] = mapped_column(String(16))  # ios | android
