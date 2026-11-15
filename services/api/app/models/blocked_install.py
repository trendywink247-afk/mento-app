"""A blocked member's install, kept after they erase their account (founder, 2026-11-10).

Erasure is a right, so a suspended or banned member may erase everything. What stays is NOT the person: only a
one-way hash of the install label and the date the block ends, so a new account from that install is still
flagged for the team (services/member_status.flag_rejoin), exactly as before the erasure. No name, no persona, no
content. Rows past `until` are ignored and pruned."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin, UUIDMixin


class BlockedInstall(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "blocked_installs"

    install_hash: Mapped[str] = mapped_column(String(64), index=True)
    # NULL = until lifted (an open-ended suspension or ban).
    blocked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
