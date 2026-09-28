"""Conversation lifecycle — the ONE place a conversation stops being active.

Every end path (member End / Wipe / Report / Block, mentor End, admin Suspend) goes
through `lock` + `end`, so the rules can't drift between routers:

- Lock order is always conversation row → listener row. The member report path used
  to take them the other way round and could deadlock against a mentor End.
- The listener's slot is released exactly once, on the active → ended transition,
  by an atomic guarded UPDATE (see matching.release_listener_slot).
- Own chat (WS5 T5.4): an end queues `ended` for the conversation's sockets, a Clean
  Wipe deletes the message bodies and queues `wiped`; both go out only once the
  caller's transaction COMMITS (services/chat_events.py), and `ended` closes the
  sockets.
- `seal` is the Stream half of a SAFETY end (report / block / suspend): the channel is
  frozen server-side so nobody can write into it again. Best-effort and never silent —
  a Stream outage must not stop a report from being filed.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.chat_message import ChatMessage, ChatReadMarker
from app.models.conversation import Conversation
from app.models.enums import ConversationEndedBy, ConversationStatus
from app.services import chat_events, stream
from app.services.matching import release_listener_slot

logger = logging.getLogger("mento.conversations")


def lock(db: Session, convo_id: str) -> Conversation | None:
    """Row-lock one conversation (SELECT … FOR UPDATE) and return the CURRENT row —
    `populate_existing` so a copy already in this session's identity map can't hide a
    status another transaction just committed."""
    return db.execute(
        select(Conversation)
        .where(Conversation.id == convo_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()


def end(db: Session, convo: Conversation, ended_by: ConversationEndedBy) -> bool:
    """active → ended, releasing the listener's slot. Idempotent: returns False (and
    changes nothing) when the conversation was not active. The CALLER holds the row
    lock and commits."""
    if convo.status != ConversationStatus.active:
        return False
    convo.status = ConversationStatus.ended
    convo.ended_at = datetime.now(UTC)
    convo.ended_by = ended_by
    release_listener_slot(db, convo)
    chat_events.after_commit(db, convo.id, {"t": "ended", "by": ended_by.value})
    return True


def wipe_messages(db: Session, convo: Conversation) -> int:
    """Clean Wipe's own-chat half: the message bodies are deleted from OUR database,
    for real — safety flags keep the signal only, never a body. The caller holds the
    row lock and commits; the sockets hear `wiped` once it does. Returns rows deleted."""
    n = db.execute(delete(ChatMessage).where(ChatMessage.conversation_id == convo.id)).rowcount
    db.execute(delete(ChatReadMarker).where(ChatReadMarker.conversation_id == convo.id))
    chat_events.after_commit(db, convo.id, {"t": "wiped"})
    return n


def clean_wipe(db: Session, convo: Conversation, ended_by: ConversationEndedBy) -> int:
    """Clean Wipe (DECISIONS §H.2): delete our copy of the bodies, end the chat, mark it
    wiped. The caller holds the row lock, wipes Stream's copy (while that exists) and
    commits. Wiping an already-ended chat still wipes; only an ACTIVE chat releases the
    listener's slot, and an ended chat keeps its original ended_at / ended_by."""
    deleted = wipe_messages(db, convo)
    end(db, convo, ended_by)
    if convo.ended_at is None:
        convo.ended_at = datetime.now(UTC)
        convo.ended_by = ended_by
    convo.status = ConversationStatus.wiped
    return deleted


def end_all_for_listener(db: Session, listener_id: str) -> list[str | None]:
    """End every active conversation a listener holds (admin Suspend), as `system`.
    Rows are locked in id order so two admins can't deadlock. Returns the Stream
    channel ids to seal AFTER the caller commits (None = the chat never got a channel)."""
    convos = (
        db.execute(
            select(Conversation)
            .where(
                Conversation.listener_id == listener_id,
                Conversation.status == ConversationStatus.active,
            )
            .order_by(Conversation.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        .scalars()
        .all()
    )
    return [c.stream_channel_id for c in convos if end(db, c, ConversationEndedBy.system)]


def end_all_for_member(db: Session, user_id: str) -> list[str | None]:
    """End every active conversation a MEMBER holds (suspension / ban, T3.7), as
    `system` — the mirror of `end_all_for_listener`, same id-ordered locking."""
    convos = (
        db.execute(
            select(Conversation)
            .where(
                Conversation.user_id == user_id,
                Conversation.status == ConversationStatus.active,
            )
            .order_by(Conversation.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        .scalars()
        .all()
    )
    return [c.stream_channel_id for c in convos if end(db, c, ConversationEndedBy.system)]


def seal(channel_id: str | None) -> None:
    """Freeze the Stream channel after a safety end. Call AFTER the commit — never
    hold a DB transaction across the HTTP call."""
    if not channel_id:
        return
    if not stream.freeze_channel(channel_id):
        logger.warning("channel NOT frozen after a safety end — Stream unavailable or stubbed")
