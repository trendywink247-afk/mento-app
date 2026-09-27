"""Refresh-token sessions (T3.2). One row per refresh token ever issued.

A sign-in (upgrade, opt-in onboarding, recovery) starts a FAMILY; every refresh
rotates: the presented row is revoked and a new row in the same family points back
at it (`rotated_from`). Presenting a row that is already revoked is reuse — the
token was stolen or replayed — and revokes the whole family.

Only a SHA-256 of the refresh token is stored (`token_hash`): the token is 256
random bits, so a fast hash is enough and a database read cannot mint a session.
No identity beyond the member id; `device_id` is a random per-install value the
app may send, never a hardware identifier.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin, UUIDMixin


class Session(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "sessions"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    family_id: Mapped[str] = mapped_column(String(36), index=True)
    # Public id of this refresh token (never the secret part).
    jti: Mapped[str] = mapped_column(String(32), unique=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    device_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rotated_from: Mapped[str | None] = mapped_column(String(36), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
