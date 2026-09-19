"""Safety flag raised by the crisis scan (PRD §10). Human review follows."""

from __future__ import annotations

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import SafetySignal
from app.models.mixins import TimestampMixin, UUIDMixin


class SafetyFlag(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "safety_flags"

    conversation_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    # NULL once the member has erased their account (DELETE /me): the signal stays for
    # safety review, the person does not (DECISIONS §L.11).
    user_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    signal: Mapped[SafetySignal] = mapped_column(default=SafetySignal.none, index=True)

    # We store the matched signal, NOT the message body (minimize sensitive data).
    matched_terms: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Stream message id the flag came from (when raised via the Stream webhook).
    # UNIQUE so the sync before-send hook and the async message.new safety-net
    # dedupe even when they race (scan_and_flag treats the violation as a dupe).
    stream_message_id: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )

    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    reviewed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str | None] = mapped_column(String(64), nullable=True)
