"""Safety flag raised by the crisis scan (PRD §10). Human review follows."""

from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import SafetySignal
from app.models.mixins import TimestampMixin, UUIDMixin

# Which scan lane raised a flag (T8.5). A String column, not a Postgres enum, so a
# new lane (T8.3 phrase bank, T8.4 guard model) is a code change, not ALTER TYPE.
FLAG_SOURCES: frozenset[str] = frozenset({"lexicon", "phrase_bank", "guard", "staff"})


class SafetyFlag(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "safety_flags"
    __table_args__ = (
        CheckConstraint(
            "risk_score IS NULL OR (risk_score >= 0 AND risk_score <= 1)",
            name="ck_safety_flags_risk_score_unit_range",
        ),
    )

    # Deliberately NO foreign key (T2.1): erasure deletes the conversation row but the
    # flag keeps its id — it only groups flags that came from the same chat.
    conversation_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    # The SENDER's Stream id — a member id, or a mentor's listener id when a mentor
    # wrote. NULL once that person is deleted (DECISIONS §L.11): the signal stays for
    # safety review, the person does not.
    # Deliberately NO foreign key (T2.1): the crisis scan must never have a flag
    # insert rejected — scan_and_flag reads an IntegrityError as a lost dedupe race,
    # so an FK would silently drop a mentor's crisis flag. SET NULL on delete comes
    # from the parent-delete triggers instead (migration d2a1fk000001).
    user_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    signal: Mapped[SafetySignal] = mapped_column(default=SafetySignal.none, index=True)

    # SIGNAL ONLY (program-plan invariant 5, T8.5): which lane fired, the finer
    # category it named, and how sure it was (0-1; a lexicon hit is a hard 1.0).
    # Never a word of the message — none of these can hold one.
    source: Mapped[str] = mapped_column(String(16), default="lexicon", server_default="lexicon")
    category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    risk_score: Mapped[float | None] = mapped_column(Float, nullable=True)

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
