"""Own-chat message pipeline (spike/own-chat) — replaces the Stream before-send hook.

Every message goes through `send()`, and there is no other way in: the crisis scan is no
longer a webhook we hope Stream calls, it is the function that writes the message. The
order is the same safety property the hook had (DECISIONS §L.2): scan first, allowance
only for a message the scan did NOT flag, then redaction, then persist. All of it reuses
the existing services unchanged (`safety.scan_and_flag`, `allowance.register`,
`moderation.redact`, `snooze`) — the spike moves them, it does not rewrite them.

Sync on purpose (Session-based, like the services it calls); the WebSocket layer runs it
in a worker thread.

`Conversation.stream_channel_id` is reused as the opaque channel key the allowance and
snooze services look conversations up by; for own-chat conversations it equals the
conversation id. (Follow-up: rename the column to `channel_key`.)
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.chat_message import ChatMessage, ChatReadMarker
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus
from app.services import allowance, moderation, safety, snooze

logger = logging.getLogger("mento.chat")

MAX_BODY = 4000


def channel_key(convo: Conversation) -> str:
    return convo.stream_channel_id or convo.id


def side_of(convo: Conversation, actor_id: str) -> str | None:
    """'member' | 'mentor' | None — the only authorization the chat needs."""
    if actor_id == convo.user_id:
        return "member"
    if actor_id == convo.listener_id:
        return "mentor"
    return None


@dataclass
class Sent:
    message: dict | None  # None when held
    held: dict | None  # allowance payload when held
    duplicate: bool = False


def message_out(m: ChatMessage) -> dict:
    """The wire shape. `crisis` mirrors the object the Stream hook attached, so the
    existing CrisisCard renders unchanged."""
    out: dict = {
        "id": m.id,
        "seq": m.seq,
        "sender": m.sender_id,
        "text": m.body,
        "ts": m.created_at.isoformat(),
        "client_id": m.client_id,
    }
    if m.crisis_signal:
        out["crisis"] = {
            "support": safety.SUPPORT_COPY,
            "signal": m.crisis_signal,
            "helplines": get_settings().helplines,
        }
    if m.redacted:
        out["moderation"] = {"redacted": True}
    return out


def _next_seq(db: Session, conversation_id: str) -> int:
    # The conversation row lock serialises senders in ONE conversation only.
    db.execute(
        select(Conversation.id).where(Conversation.id == conversation_id).with_for_update()
    )
    top = db.execute(
        select(func.coalesce(func.max(ChatMessage.seq), 0)).where(
            ChatMessage.conversation_id == conversation_id
        )
    ).scalar_one()
    return int(top) + 1


def send(db: Session, convo: Conversation, sender_id: str, text: str, client_id: str) -> Sent:
    text = (text or "").strip()
    if not text:
        raise ValueError("empty message")
    text = text[:MAX_BODY]

    prior = db.execute(
        select(ChatMessage).where(
            ChatMessage.conversation_id == convo.id,
            ChatMessage.sender_id == sender_id,
            ChatMessage.client_id == client_id,
        )
    ).scalar_one_or_none()
    if prior is not None:  # a retry of a send we already stored: same answer, no new row
        return Sent(message=message_out(prior), held=None, duplicate=True)

    message_id = str(uuid.uuid4())
    key = channel_key(convo)

    # 1. Crisis scan on the ORIGINAL text, before anything else can stop the message.
    result = safety.scan_and_flag(
        db,
        text=text,
        user_id=sender_id,
        conversation_id=convo.id,
        stream_message_id=message_id,
    )
    if result.triggered:
        if snooze.end_for_crisis(db, convo.id, sender_id):
            db.commit()
        if side_of(convo, sender_id) == "member" and allowance_on():
            allowance.note_crisis_exempt(db, channel_id=key, sender_id=sender_id)
    elif allowance_on():
        # 2. Allowance — only ever for a message the scan did NOT flag.
        verdict = allowance.register(db, channel_id=key, sender_id=sender_id)
        if verdict is not None and verdict.held:
            return Sent(message=None, held=_held(verdict))

    # 3. Redact what the recipient receives (fail-open, like the hook).
    body = text
    redacted = False
    try:
        red = moderation.redact(text)
        body, redacted = red.text, red.redacted
    except Exception:  # noqa: BLE001 — never block a support message on a PII scan
        logger.error("redaction failed — delivering original")

    # 4. Persist. seq is allocated under the conversation row lock.
    row = ChatMessage(
        id=message_id,
        conversation_id=convo.id,
        sender_id=sender_id,
        seq=_next_seq(db, convo.id),
        client_id=client_id,
        body=body,
        crisis_signal=result.signal.value if result.triggered else None,
        redacted=redacted,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        # Two sends with the same client_id raced; the loser returns the winner's row.
        db.rollback()
        winner = db.execute(
            select(ChatMessage).where(
                ChatMessage.conversation_id == convo.id,
                ChatMessage.sender_id == sender_id,
                ChatMessage.client_id == client_id,
            )
        ).scalar_one()
        return Sent(message=message_out(winner), held=None, duplicate=True)

    if side_of(convo, sender_id) == "mentor":
        snooze.end_on_mentor_reply(key, sender_id)
    return Sent(message=message_out(row), held=None)


def allowance_on() -> bool:
    return get_settings().allowance_enabled


def _held(verdict: allowance.Verdict) -> dict:
    s = verdict.state
    return {
        "held": True,
        "reason": verdict.held,
        "text": allowance.note(verdict.held or allowance.REASON_IN_A_ROW),
        "in_a_row": s.in_a_row,
        "in_a_row_limit": s.in_a_row_limit,
        "left_today": s.left_today,
        "daily_limit": s.daily_limit,
        "resets_at": s.resets_at.isoformat(),
    }


def history(db: Session, conversation_id: str, after_seq: int = 0, limit: int = 200) -> list[dict]:
    rows = (
        db.execute(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id, ChatMessage.seq > after_seq)
            .order_by(ChatMessage.seq)
            .limit(limit)
        )
        .scalars()
        .all()
    )
    return [message_out(r) for r in rows]


def last_seq(db: Session, conversation_id: str) -> int:
    return int(
        db.execute(
            select(func.coalesce(func.max(ChatMessage.seq), 0)).where(
                ChatMessage.conversation_id == conversation_id
            )
        ).scalar_one()
    )


def mark_read(db: Session, conversation_id: str, reader_id: str, seq: int) -> int:
    """Move the reader's marker forward (never back). Returns the marker."""
    seq = min(seq, last_seq(db, conversation_id))
    row = db.get(ChatReadMarker, (conversation_id, reader_id))
    if row is None:
        row = ChatReadMarker(conversation_id=conversation_id, reader_id=reader_id, last_read_seq=0)
        db.add(row)
    if seq > row.last_read_seq:
        row.last_read_seq = seq
    db.commit()
    return row.last_read_seq


def read_markers(db: Session, conversation_id: str) -> dict[str, int]:
    rows = db.execute(
        select(ChatReadMarker).where(ChatReadMarker.conversation_id == conversation_id)
    ).scalars()
    return {r.reader_id: r.last_read_seq for r in rows}


def wipe(db: Session, conversation_id: str) -> int:
    """Clean Wipe: the bodies are deleted from OUR database, for real. Safety flags keep
    the signal only (never a body), exactly as before."""
    n = db.execute(
        delete(ChatMessage).where(ChatMessage.conversation_id == conversation_id)
    ).rowcount
    db.execute(delete(ChatReadMarker).where(ChatReadMarker.conversation_id == conversation_id))
    db.commit()
    return n


def is_open(convo: Conversation) -> bool:
    return convo.status == ConversationStatus.active
