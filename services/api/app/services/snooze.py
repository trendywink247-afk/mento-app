"""Snooze 24 h (board A10; DECISIONS §L, founder 2026-09-19) — the mentor's honest
"I can't reply today" for one conversation that is waiting on them.

What a snooze does, while `conversations.snoozed_until` is in the future:
- the conversation sorts after the un-snoozed ones in the mentor's console
  (`GET /listener/me/conversations`) and reads "Snoozed · back at <time>";
- the mentor gets no message pushes for it (services/push.py, reason `snoozed`);
- the capacity sweep does not end it as stale (services/matching.py);
- the member is told, kindly, "<mentor> will reply within a day" (`reply_within_a_day`
  on their conversation payloads) — never "snoozed", never anything that shames.

What ends it early:
- a crisis-flagged MEMBER message (`end_for_crisis`, called from the Stream hooks AFTER
  the scan has flagged — the scan always runs first). A snooze never hides a crisis;
- the mentor's own reply (`end_on_mentor_reply`, a job queued by the async
  message.new hook) — once they have written, nothing is waiting on them any more;
- the mentor's undo (`DELETE …/snooze`).

A member's ordinary new message does NOT end it: the point is "I can't reply today".
Snoozing again while snoozed never extends the window (no rolling postponement).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus

logger = logging.getLogger("mento.snooze")


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def is_snoozed(convo: Conversation, now: datetime | None = None) -> bool:
    """True while an ACTIVE conversation's snooze window is still open."""
    if convo.status != ConversationStatus.active or convo.snoozed_until is None:
        return False
    return _aware(convo.snoozed_until) > (now or datetime.now(UTC))


def snoozed_until_iso(convo: Conversation, now: datetime | None = None) -> str | None:
    return _aware(convo.snoozed_until).isoformat() if is_snoozed(convo, now) else None


def snooze(convo: Conversation, now: datetime | None = None) -> datetime:
    """Start the window (caller holds the row lock and commits). Idempotent and never
    extending: a conversation already snoozed keeps its current end time."""
    now = now or datetime.now(UTC)
    if not is_snoozed(convo, now):
        convo.snoozed_until = now + timedelta(hours=get_settings().snooze_hours)
    return _aware(convo.snoozed_until)


def wake(convo: Conversation) -> None:
    """Undo (caller holds the row lock and commits). Idempotent."""
    convo.snoozed_until = None


def end_for_crisis(db: Session, conversation_id: str | None, sender_id: str) -> bool:
    """A crisis-flagged message from the MEMBER ends any snooze on their conversation
    at once, so the mentor is pushed and the chat returns to the top of their console.
    One guarded UPDATE (no read, no lock order to get wrong); the caller commits.
    Returns True when a snooze was ended."""
    if not conversation_id:
        return False
    result = db.execute(
        update(Conversation)
        .where(
            Conversation.id == conversation_id,
            Conversation.user_id == sender_id,
            Conversation.snoozed_until.is_not(None),
        )
        .values(snoozed_until=None, updated_at=Conversation.updated_at)
    )
    if result.rowcount:
        logger.info("snooze ended by a crisis flag")
    return bool(result.rowcount)


def end_on_mentor_reply(db: Session, channel_id: str, sender_id: str) -> bool:
    """The mentor wrote in a snoozed chat, so nothing is waiting on them — drop the
    snooze and the member's "will reply within a day" line with it. Runs as the
    `snooze.end_on_mentor_reply` job (WS4), retried by the queue; commits. Idempotent:
    a second run finds no snooze. Returns True when a snooze was ended."""
    result = db.execute(
        update(Conversation)
        .where(
            Conversation.stream_channel_id == channel_id,
            Conversation.listener_id == sender_id,
            Conversation.snoozed_until.is_not(None),
        )
        .values(snoozed_until=None, updated_at=Conversation.updated_at)
    )
    db.commit()
    return bool(result.rowcount)
