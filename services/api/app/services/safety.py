"""Shared crisis scan-and-flag logic.

One code path for every entry point (the Stream before-send hook, the message.new
safety-net webhook, and the legacy /safety/scan endpoint), so the safety behaviour
can't drift between them. Persists the SIGNAL only — never the message body
(Trust & Safety #6). Deduped by Stream message id so the sync hook and the async
safety net don't double-flag the same message.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.safety import FLAG_SOURCES, SafetyFlag
from app.services import crisis
from app.services.crisis import CrisisResult

logger = logging.getLogger(__name__)

# Support-and-refer copy shown when a crisis signal is detected. Never retain;
# point the person to trained help. Shared by every entry point.
SUPPORT_COPY = (
    "It sounds like you're going through something really heavy right now, and you "
    "don't have to face it alone. The people below are trained to help, any time of day."
)


def scan_and_flag(
    db: Session,
    *,
    text: str,
    user_id: str,
    conversation_id: str | None = None,
    stream_message_id: str | None = None,
    source: str = "lexicon",
    category: str | None = None,
    risk_score: float | None = None,
) -> CrisisResult:
    """Scan text; on a crisis signal, persist a (deduped) SafetyFlag. Returns the result.

    `source` / `category` / `risk_score` describe the lane that fired (T8.5). The
    lexicon defaults are its signal as the category and a hard 1.0 score; later lanes
    pass their own. None of the three may carry text from the message.
    """
    _check_lane(source, risk_score)
    result = crisis.scan(text)
    if not result.triggered:
        return result
    record_flag(
        db,
        result,
        user_id=user_id,
        conversation_id=conversation_id,
        stream_message_id=stream_message_id,
        source=source,
        category=category,
        risk_score=risk_score,
    )
    return result


def _check_lane(source: str, risk_score: float | None) -> None:
    if source not in FLAG_SOURCES:
        raise ValueError(f"unknown flag source {source!r}")
    if risk_score is not None and not 0.0 <= risk_score <= 1.0:
        raise ValueError("risk_score must be within 0..1")


def record_flag(
    db: Session,
    result: CrisisResult,
    *,
    user_id: str,
    conversation_id: str | None = None,
    stream_message_id: str | None = None,
    source: str = "lexicon",
    category: str | None = None,
    risk_score: float | None = None,
) -> None:
    """Persist (deduped, committed) the SIGNAL of a triggered scan — never the text.
    The write half of `scan_and_flag`, for a caller that ran the scan itself (the
    own-chat write path, services/chat.py)."""
    _check_lane(source, risk_score)
    if stream_message_id is not None:
        already = db.execute(
            select(SafetyFlag.id).where(SafetyFlag.stream_message_id == stream_message_id)
        ).first()
        if already:
            return

    db.add(
        SafetyFlag(
            conversation_id=conversation_id,
            user_id=user_id,
            signal=result.signal,
            # SIGNAL ONLY — the matched substrings are verbatim message fragments
            # (Trust & Safety #6: never persist the body). The enum category is all
            # a human reviewer needs to triage.
            matched_terms=result.signal.value,
            stream_message_id=stream_message_id,
            source=source,
            category=category or result.signal.value,
            risk_score=1.0 if risk_score is None and source == "lexicon" else risk_score,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # The sync before-send hook and the async message.new net raced on the same
        # message — the unique index makes the dedupe real; losing the race is fine.
        db.rollback()


def scan_request_intro(db: Session, *, text: str | None, user_id: str) -> CrisisResult | None:
    """The crisis scan for the words a member writes with a request, run when the request is created
    (founder, 2026-11-10). A mentor can read those words in their inbox before any chat exists, so they get the
    same scan a chat message gets: a signal-only flag for the safety team, and the helpline card back to the member.
    Never blocks the request, and fail-open like every crisis scan: a fault delivers the request unscanned and logs
    at ERROR. Returns the result only when it triggered."""
    if not text or not text.strip():
        return None
    try:
        result = scan_and_flag(db, text=text, user_id=user_id)
    except Exception as exc:  # noqa: BLE001 — never block a request for help
        logger.error("crisis scan of a request FAILED (%s) — sending unscanned", type(exc).__name__)
        return None
    return result if result.triggered else None
