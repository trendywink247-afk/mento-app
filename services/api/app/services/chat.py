"""Own-chat message pipeline (WS5) — the ONE write path for a chat message.

`send()` is the only way a message is stored (T5.2; `persist_message` is the only place
that builds a `ChatMessage`, and a test walks the AST of app/ to keep it so). It runs,
in this order and nowhere else:

    1. standing       — a participant, the chat open, the member not suspended/banned,
                        the mentor still approved
    2. crisis scan    — on the ORIGINAL text, before anything can stop the message;
                        a hit writes the signal (never the text) and ends a snooze
    3. allowance      — only for a message the scan did NOT flag (DECISIONS §L.2): a
                        crisis message is never held and never counted
    4. redaction      — what the other side receives
    5. insert + seq   — under the conversation's row lock; commit
    6. publish        — to every socket of the conversation, on every worker
    7. enqueue jobs   — push, snooze end; ids only

Fail-open, never silent (program-plan invariant 1): a scan, flag write, allowance or
redaction fault delivers the message and logs at ERROR/WARNING, so the alerting sees it.
A standing refusal is the one hard stop — it runs before the scan because a suspended
account must not be able to write at all.

Each stage is a module-level function so tests can spy on the order. Sync on purpose
(Session-based, like the services it calls); the WebSocket layer runs it in a worker
thread, and `publish` hops back onto the event loop from there.

`Conversation.stream_channel_id` is reused as the opaque channel key the allowance and
snooze services look conversations up by; for own-chat conversations it equals the
conversation id (the rename to `channel_ref` is T5.5).
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import jobs
from app.config import get_settings
from app.jobs import tasks
from app.models.chat_message import ChatMessage, ChatReadMarker
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, MemberStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.services import (
    allowance,
    chat_events,
    crisis,
    member_status,
    message_crypto,
    moderation,
    safety,
    snooze,
)
from app.services.crisis import CrisisResult

logger = logging.getLogger("mento.chat")

MAX_BODY = 4000
# A stable namespace for message ids: the same (conversation, sender, client_id) always
# names the same message, so a retry can never mint a second id — or a second flag.
_MESSAGE_NS = uuid.UUID("6c1d1f0e-3b7a-4c55-9d1e-6f0a7a1c2b01")


class NotAllowed(Exception):
    """The send is refused before anything is written. `code` goes to the client."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


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


@dataclass
class Duplicate:
    """`persist_message` found the message already stored (a retried send)."""

    message: dict


def message_out(m: ChatMessage, text: str | None = None) -> dict:
    """The wire shape. `crisis` mirrors the object the Stream hook attached, so the
    existing CrisisCard renders unchanged. The body is decrypted here unless the caller
    already holds the plaintext (the write path, which just encrypted it)."""
    if text is None:
        text = message_crypto.decrypt(
            m.body, m.key_id, message_id=m.id, conversation_id=m.conversation_id
        )
    out: dict = {
        "id": m.id,
        "seq": m.seq,
        "sender": m.sender_id,
        "sender_kind": m.sender_kind,
        "text": text,
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


def message_id_for(conversation_id: str, sender_id: str, client_id: str) -> str:
    return str(uuid.uuid5(_MESSAGE_NS, f"{conversation_id}:{sender_id}:{client_id}"))


# ---- the write path ------------------------------------------------------------------------


def send(db: Session, sender_id: str, conversation_id: str, *, client_id: str, body: str) -> Sent:
    """Store and deliver one message — the only way in. Raises `NotAllowed` (nothing
    written) for a refused sender, a closed chat or an empty / oversized body."""
    client_id = (client_id or "").strip()[:64]
    text = (body or "").strip()
    if not client_id:
        raise NotAllowed("client_id_required")
    if not text:
        raise NotAllowed("empty")
    if len(text) > MAX_BODY:
        raise NotAllowed("too_long")

    # 1. standing
    convo, kind = check_standing(db, conversation_id, sender_id)

    prior = _prior(db, conversation_id, sender_id, client_id)
    if prior is not None:  # a retry of a send we already stored: same answer, no new row
        return Sent(message=message_out(prior), held=None, duplicate=True)
    message_id = message_id_for(conversation_id, sender_id, client_id)

    # 2. crisis scan — before anything else can stop the message
    result = scan_message(text)
    flagged = result is not None and result.triggered
    if flagged:
        _record_crisis(db, convo, result, sender_id=sender_id, message_id=message_id)

    # 3. allowance — never for a flagged message
    if not flagged:
        verdict = apply_allowance(db, convo, kind, sender_id)
        if verdict is not None and verdict.held:
            return Sent(message=None, held=_held(verdict))

    # 4. redaction
    out_text, redacted = redact_text(text)

    # 5. insert with seq + commit
    stored = persist_message(
        db,
        conversation_id,
        message_id=message_id,
        sender_kind=kind,
        sender_id=sender_id,
        client_id=client_id,
        body=out_text,
        crisis_signal=result.signal.value if flagged else None,
        redacted=redacted,
    )
    if isinstance(stored, Duplicate):  # lost a same-client_id race to a twin
        return Sent(message=stored.message, held=None, duplicate=True)

    # 6. publish
    publish(conversation_id, {"t": "message", "message": stored})

    # 7. enqueue jobs
    enqueue_after_send(db, conversation_id, kind=kind, sender_id=sender_id, flagged=flagged)
    return Sent(message=stored, held=None)


def check_standing(db: Session, conversation_id: str, sender_id: str) -> tuple[Conversation, str]:
    convo = db.get(Conversation, conversation_id)
    kind = side_of(convo, sender_id) if convo is not None else None
    if kind is None:
        raise NotAllowed("not_a_participant")  # same answer for "no such chat"
    if not is_open(convo):
        raise NotAllowed("ended")
    if kind == "member":
        row = db.execute(select(User.status, User.banned_until).where(User.id == sender_id)).first()
        if row is not None:
            now = member_status.standing(row[0], row[1])
            if now.status != MemberStatus.active:
                raise NotAllowed(f"member_{now.status.value}")
    else:
        vetting = db.execute(
            select(ListenerProfile.vetting_status).where(ListenerProfile.id == sender_id)
        ).scalar_one_or_none()
        if vetting != VettingStatus.approved:
            raise NotAllowed("mentor_suspended")
    return convo, kind


def scan_message(text: str) -> CrisisResult | None:
    """The lexicon scan. Pure — no database. Fail-open, never silent: a fault delivers
    the message unscanned and logs at ERROR (Sentry and the crisis health check)."""
    try:
        return crisis.scan(text)
    except Exception as exc:  # noqa: BLE001 — never block a support message
        logger.error("crisis scan FAILED (%s) — delivering unscanned", type(exc).__name__)
        return None


def _record_crisis(
    db: Session, convo: Conversation, result: CrisisResult, *, sender_id: str, message_id: str
) -> None:
    """Write the signal, then end a snooze the member's crisis should wake. A failure
    here never costs the helpline card — the message still carries it."""
    try:
        safety.record_flag(
            db,
            result,
            user_id=sender_id,
            conversation_id=convo.id,
            stream_message_id=message_id,
        )
    except Exception as exc:  # noqa: BLE001 — the card must survive any fault
        db.rollback()
        logger.error(
            "crisis flag NOT persisted (%s) — delivering with the helpline card",
            type(exc).__name__,
        )
        return
    try:
        if snooze.end_for_crisis(db, convo.id, sender_id):
            db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("snooze not ended for a crisis (%s)", type(exc).__name__)


def apply_allowance(
    db: Session, convo: Conversation, kind: str, sender_id: str
) -> allowance.Verdict | None:
    """Count a NON-crisis message (a mentor's resets the member's run). The count stays
    in the open transaction, so the message and its count commit together
    (`persist_message`). Fail-open: a fault delivers the message uncounted, and says so."""
    if not get_settings().allowance_enabled:
        return None
    try:
        verdict = allowance.register(
            db, channel_id=channel_key(convo), sender_id=sender_id, commit=False
        )
        if verdict is not None and verdict.held:
            db.commit()  # a held message is not stored, but its cap hit is kept
        return verdict
    except Exception as exc:  # noqa: BLE001 — the allowance must never stop a message
        db.rollback()
        logger.warning("message allowance unavailable (%s) — delivering", type(exc).__name__)
        return None


def redact_text(text: str) -> tuple[str, bool]:
    """PII redaction of what the recipient receives. Fail-open, never silent."""
    try:
        red = moderation.redact(text)
        return red.text, red.redacted
    except Exception as exc:  # noqa: BLE001 — never block a support message on a PII scan
        logger.error("redaction failed (%s) — delivering original", type(exc).__name__)
        return text, False


def persist_message(
    db: Session,
    conversation_id: str,
    *,
    message_id: str,
    sender_kind: str,
    sender_id: str,
    client_id: str,
    body: str,
    crisis_signal: str | None,
    redacted: bool,
) -> dict | Duplicate:
    """THE insert. Under the conversation's row lock: re-check the client_id (a twin
    may have landed since `send` looked), allocate the next seq, encrypt the body
    (services/message_crypto.py — never stored in the clear), insert, commit — one
    commit for the message and the allowance count `send` left in the transaction.

    The lock is the exactly-once guarantee: the table is partitioned, so it cannot
    carry a unique constraint on (conversation, seq) or (conversation, sender,
    client_id). A missing MESSAGE_KEY outside dev raises here, before any write."""
    _lock_conversation(db, conversation_id)
    prior = _prior(db, conversation_id, sender_id, client_id)
    if prior is not None:
        out = message_out(prior)
        db.rollback()  # release the lock; this send's allowance count goes with it
        return Duplicate(out)
    sealed, key_id = message_crypto.encrypt(
        body, message_id=message_id, conversation_id=conversation_id
    )
    row = ChatMessage(
        id=message_id,
        conversation_id=conversation_id,
        sender_kind=sender_kind,
        sender_id=sender_id,
        seq=_top_seq(db, conversation_id) + 1,
        client_id=client_id,
        body=sealed,
        key_id=key_id,
        crisis_signal=crisis_signal,
        redacted=redacted,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        # Backstop for the lock: the unique constraints caught a twin.
        db.rollback()
        winner = _prior(db, conversation_id, sender_id, client_id)
        if winner is None:
            raise
        return Duplicate(message_out(winner))
    return message_out(row, text=body)


def publish(conversation_id: str, event: dict) -> None:
    """Stage 6: fan out to every socket of the conversation (services/chat_events.py)."""
    chat_events.publish(conversation_id, event)


def enqueue_after_send(
    db: Session, conversation_id: str, *, kind: str, sender_id: str, flagged: bool
) -> None:
    """What follows a delivered message, as jobs (WS4): the push to the other side, and
    — if the mentor wrote in a chat they snoozed — ending that snooze. A member's crisis
    message is tallied as crisis-exempt (numbers only). Best-effort: the message is
    already stored and delivered; a refused job costs a push, never the send."""
    try:
        convo = db.get(Conversation, conversation_id)
        if convo is None:
            return
        key = channel_key(convo)
        if kind == "mentor" and convo.snoozed_until is not None:
            jobs.enqueue(
                db,
                tasks.snooze_end_on_mentor_reply,
                best_effort=True,
                channel_id=key,
                sender_id=sender_id,
            )
        jobs.enqueue(db, tasks.push_message, best_effort=True, channel_id=key, sender_id=sender_id)
        db.commit()
        if flagged and kind == "member" and get_settings().allowance_enabled:
            allowance.note_crisis_exempt(db, channel_id=key, sender_id=sender_id)
    except Exception as exc:  # noqa: BLE001 — best-effort by design
        db.rollback()
        logger.warning("jobs not queued after a message (%s)", type(exc).__name__)


# ---- helpers ------------------------------------------------------------------------------


def _prior(db: Session, conversation_id: str, sender_id: str, client_id: str):
    return db.execute(
        select(ChatMessage).where(
            ChatMessage.conversation_id == conversation_id,
            ChatMessage.sender_id == sender_id,
            ChatMessage.client_id == client_id,
        )
    ).scalar_one_or_none()


def _lock_conversation(db: Session, conversation_id: str) -> None:
    # The conversation row lock serialises senders in ONE conversation only.
    db.execute(select(Conversation.id).where(Conversation.id == conversation_id).with_for_update())


def _top_seq(db: Session, conversation_id: str) -> int:
    return int(
        db.execute(
            select(func.coalesce(func.max(ChatMessage.seq), 0)).where(
                ChatMessage.conversation_id == conversation_id
            )
        ).scalar_one()
    )


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


@dataclass
class Opening:
    """Everything a socket's hello needs, from ONE database round (T5.3)."""

    side: str
    peer_id: str
    last_seq: int
    read: dict[str, int]
    replay: list[dict]


def opening(db: Session, conversation_id: str, actor_id: str, after_seq: int) -> Opening | None:
    """Authorize a socket and snapshot what it missed. None = refuse (no such chat,
    not a participant, or ended — one answer for all three)."""
    convo = db.get(Conversation, conversation_id)
    side = side_of(convo, actor_id) if convo is not None else None
    if side is None or not is_open(convo):
        return None
    return Opening(
        side=side,
        peer_id=convo.listener_id if side == "member" else convo.user_id,
        last_seq=last_seq(db, conversation_id),
        read=read_markers(db, conversation_id),
        replay=history(db, conversation_id, max(0, after_seq)),
    )


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
    return _top_seq(db, conversation_id)


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


def is_open(convo: Conversation) -> bool:
    return convo.status == ConversationStatus.active
