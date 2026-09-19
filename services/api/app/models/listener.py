"""Listener/mentor profile. In v1 chat, listeners appear as anonymous personas."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, Integer, String, event
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import Gender, ListenerStatus, VettingStatus
from app.models.mixins import TimestampMixin, UUIDMixin


class ListenerProfile(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "listener_profiles"

    persona_name: Mapped[str] = mapped_column(String(64), index=True)
    persona_avatar: Mapped[str] = mapped_column(String(64))

    gender: Mapped[Gender] = mapped_column(default=Gender.undisclosed)
    # Issue categories this listener accepts (life/emotional-leaning in v1).
    categories: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Path (Communities): the road this listener has walked (upsc/neet/…).
    # Null = serves every community. Soft matching preference, never a hard filter.
    community_slug: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)

    status: Mapped[ListenerStatus] = mapped_column(default=ListenerStatus.offline, index=True)
    vetting_status: Mapped[VettingStatus] = mapped_column(default=VettingStatus.pending, index=True)

    # Non-cash reputation (PRD §9). Higher rank → higher match priority.
    rank: Mapped[int] = mapped_column(Integer, default=0)
    active_conversations: Mapped[int] = mapped_column(Integer, default=0)
    max_concurrent: Mapped[int] = mapped_column(Integer, default=3)

    # Native-console presence (spec 2026-09-05 §6). Stamped ONLY by the heartbeat
    # endpoint; reset to NULL when the listener sets themselves online, so a
    # listener that never heartbeats (seeds, the web console) is never swept.
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Chat-profile fields (spec 2026-09-06 "Two in the room"). Mentor-editable via
    # PUT /listener/me/profile; admin can clear public_line but not set it.
    public_line: Mapped[str | None] = mapped_column(String(120), nullable=True)
    availability_note: Mapped[str | None] = mapped_column(String(60), nullable=True)

    # Rotating names (DECISIONS §L.6, services/mentor_names.py). The rotation day the
    # current persona_name belongs to — NULL = not stamped yet (the next pass stamps it
    # WITHOUT renaming, so a new mentor keeps their first name for the rest of its day).
    persona_name_day: Mapped[date | None] = mapped_column(Date, nullable=True)
    # False while Stream still shows the previous name (the rename is pushed after the
    # commit, best-effort; the next pass retries).
    persona_stream_synced: Mapped[bool] = mapped_column(
        Boolean, default=True, server_default="true"
    )

    # One mentor, one face (services/mentor_face.py): the companion animal + wash colour
    # every member-facing surface and Mentor Home draw for this mentor. Dealt once from
    # the listener id (insert hook below / backfill migration); never rotates with the
    # name (DECISIONS §L.6 l).
    companion_animal: Mapped[str | None] = mapped_column(String(32), nullable=True)
    companion_colour: Mapped[str | None] = mapped_column(String(32), nullable=True)


@event.listens_for(ListenerProfile, "before_insert")
def _deal_face(_mapper, _connection, target: ListenerProfile) -> None:
    # Every creation path (admin approval, admin provisioning, seeds, tests) gets a face.
    from app.services import mentor_face

    mentor_face.assign(target)
