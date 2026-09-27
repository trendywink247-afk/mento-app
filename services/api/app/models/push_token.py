"""Expo push tokens — device registration for remote push.

Tied to whichever anonymous identity currently owns the device — a member
(`User` id) or a listener (`ListenerProfile` id) — never real identity (T&S:
anonymity integrity). Unique on the token value (not the owner) so a device
reinstall, or a device that flips between the member and listener roles, always
re-points the existing row instead of leaving stale duplicates.
"""

from __future__ import annotations

from sqlalchemy import Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import PushOwnerKind
from app.models.mixins import TimestampMixin, UUIDMixin


class PushToken(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "push_tokens"
    __table_args__ = (
        # One row per device token PER ROLE: a phone that is both a member and a mentor
        # keeps both registrations (session 31f device finding — a single-token rule let
        # whichever surface registered last steal the row, silencing the other role).
        UniqueConstraint("expo_push_token", "owner_kind", name="uq_push_token_value_kind"),
        Index("ix_push_tokens_owner", "owner_kind", "owner_id"),
    )

    # Legacy column — kept one release for backfill; `owner_*` is the truth. It holds a
    # listener id on listener rows, so it can carry no foreign key.
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    # Who this device belongs to right now: a member (User id) or a listener
    # (ListenerProfile id). One physical device can flip between the two.
    owner_kind: Mapped[PushOwnerKind] = mapped_column(default=PushOwnerKind.member)
    # Polymorphic, so no plain FK: a deferred Postgres constraint trigger (migration
    # d2a1fk000001) rejects an owner that does not exist for its kind, and deleting
    # the member / listener deletes their rows (CASCADE semantics, per role).
    owner_id: Mapped[str] = mapped_column(String(36))
    expo_push_token: Mapped[str] = mapped_column(String(255), index=True)
    platform: Mapped[str] = mapped_column(String(16))  # ios | android
