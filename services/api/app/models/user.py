"""Anonymous user. Minimal PII by design (Trust & Safety #6)."""
from __future__ import annotations

from datetime import date

from sqlalchemy import Date, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin, UUIDMixin


class User(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "users"

    # Anonymous persona shown in chat (e.g. "Purple Valley").
    persona_name: Mapped[str] = mapped_column(String(64), index=True)
    persona_avatar: Mapped[str] = mapped_column(String(64))  # avatar seed/key

    # Age gate inputs. DOB is the source of truth; age is derived server-side.
    dob: Mapped[date] = mapped_column(Date)
    age_at_signup: Mapped[int] = mapped_column(Integer)

    # Optional email — recovery only, never shown to others, never required.
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Growth companion (personalization/theme; NEVER the chat handle).
    companion_animal: Mapped[str | None] = mapped_column(String(32), nullable=True)
    companion_colour: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Path (Communities): coarse, self-declared, clearable — a matching lens, not PII.
    community_slug: Mapped[str | None] = mapped_column(String(32), nullable=True)
    journey_stage: Mapped[str | None] = mapped_column(String(48), nullable=True)
