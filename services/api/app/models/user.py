"""Anonymous user. Minimal PII by design (Trust & Safety #6)."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import MemberStatus
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
    # The member's own name for it (services/companions.clean_name). Only the member
    # reads it back — never a mentor, Stream, analytics or the admin dashboard.
    companion_name: Mapped[str | None] = mapped_column(String(24), nullable=True)

    # Path (Communities): coarse, self-declared, clearable — a matching lens, not PII.
    community_slug: Mapped[str | None] = mapped_column(String(32), nullable=True)
    journey_stage: Mapped[str | None] = mapped_column(String(48), nullable=True)

    # Standing (T3.7, services/member_status.py). Suspended/banned members are refused
    # by security.current_user_id; `banned_until` bounds either (NULL = until lifted).
    status: Mapped[MemberStatus] = mapped_column(
        default=MemberStatus.active, server_default=MemberStatus.active.value
    )
    banned_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # SHA-256 of the app's random per-install id — a re-join SIGNAL only (a new account
    # from a blocked member's install is flagged for review, never refused). Not a
    # hardware id, never shown to anyone, never sent to analytics.
    install_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    # Terms acceptance (T3.9, services/terms.py): when, and which version.
    terms_accepted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    terms_version: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # Recovery code (T3.5, services/recovery.py): the lookup half in the clear (it only
    # FINDS the row), the secret half as an argon2id hash. Neither can sign anyone in.
    recovery_selector: Mapped[str | None] = mapped_column(String(8), nullable=True, unique=True)
    recovery_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
