"""Shared crisis scan-and-flag logic.

One code path for every entry point (the Stream before-send hook, the message.new
safety-net webhook, and the legacy /safety/scan endpoint), so the safety behaviour
can't drift between them. Persists the SIGNAL only — never the message body
(Trust & Safety #6). Deduped by Stream message id so the sync hook and the async
safety net don't double-flag the same message.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.safety import SafetyFlag
from app.services import crisis
from app.services.crisis import CrisisResult

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
) -> CrisisResult:
    """Scan text; on a crisis signal, persist a (deduped) SafetyFlag. Returns the result."""
    result = crisis.scan(text)
    if not result.triggered:
        return result

    if stream_message_id is not None:
        already = db.execute(
            select(SafetyFlag.id).where(SafetyFlag.stream_message_id == stream_message_id)
        ).first()
        if already:
            return result

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
        )
    )
    try:
        db.commit()
    except IntegrityError:
        # The sync before-send hook and the async message.new net raced on the same
        # message — the unique index makes the dedupe real; losing the race is fine.
        db.rollback()
    return result
