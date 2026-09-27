"""One-time mentor console codes (T3.10).

An approved mentor asks for a code; the web console trades it ONCE, within ten
minutes, for a listener session. Only a SHA-256 of the code is stored (it is 192
random bits, so a fast hash is enough); `used_at` makes the trade single-use.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin, UUIDMixin


class ConsoleCode(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "console_codes"

    listener_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("listener_profiles.id", ondelete="CASCADE"), index=True
    )
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
