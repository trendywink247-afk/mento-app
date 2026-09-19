"""Conversation lifecycle + options sheet (DECISIONS §H.2, PRD §6/§11).

Owner-only actions on a conversation: lock (PIN), status mask, pause notifications,
end, Panda Wipe (real server delete), report, block. Report and block both END the
conversation and file a moderation event; block additionally prevents that listener
from ever being re-matched to this user (see services/matching).
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import get_db
from app.models.conversation import Conversation
from app.models.enums import ConversationEndedBy, ConversationStatus, ModerationLevel
from app.models.listener import ListenerProfile
from app.models.moderation import ModerationEvent
from app.models.reflection import ConversationReflection
from app.routers.listeners import _profile_out
from app.schemas import (
    ConversationListItem,
    ConversationState,
    ListenerProfileOut,
    LockRequest,
    OkResult,
    PauseRequest,
    ReflectionIn,
    ReportRequest,
    StatusMaskRequest,
    UnlockRequest,
    VerifyPinRequest,
)
from app.security import current_user_id, hash_pin, verify_pin
from app.services import conversations, stream

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _owned(db: Session, convo_id: str, user_id: str, *, lock: bool = False) -> Conversation:
    """Only this member's conversation; anything else is opaquely 404.

    lock=True row-locks the conversation (SELECT ... FOR UPDATE) for the end/wipe
    paths, so a member end racing a mentor end (listener_console.end_conversation)
    can't clobber ended_by/ended_at — the loser sees the already-ended row instead
    of overwriting it.
    """
    if lock:
        convo = conversations.lock(db, convo_id)
    else:
        convo = db.get(Conversation, convo_id)
    if convo is None or convo.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    return convo


def _pin_attempt_guard(convo_id: str, user_id: str) -> None:
    """A 4-digit PIN is 10⁴ guesses — without an attempt cap it's enumerable in
    minutes. 5 tries per 15 minutes per conversation+caller.

    fail_closed=True (design choice, A4): the general rate limiter fails OPEN on
    Redis outage, which for a PIN would mean unlimited guesses exactly when the
    guard is down. Here a Redis outage returns 503 ("try again shortly") instead.
    Chosen over a DB-backed attempt counter because it is drastically simpler,
    needs no migration, and the failure mode (retry later on a lock screen) is
    acceptable UX — unlike unlimited enumeration, which breaks the lock promise.
    """
    ratelimit.enforce(
        f"pin:{convo_id}:{user_id}",
        5,
        900,
        detail="Too many PIN attempts — try again in a few minutes.",
        fail_closed=True,
    )


def _state(convo: Conversation) -> ConversationState:
    return ConversationState(
        id=convo.id,
        status=convo.status.value,
        is_locked=convo.is_locked,
        is_paused=convo.is_paused,
        status_mask=convo.status_mask,
    )


@router.get("", response_model=list[ConversationListItem])
def list_conversations(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[ConversationListItem]:
    """The user's conversations, newest first — the My Chats surface (#54/55)."""
    convos = db.scalars(
        select(Conversation)
        .where(Conversation.user_id == user_id)
        .order_by(Conversation.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    listeners = {
        li.id: li
        for li in db.scalars(
            select(ListenerProfile).where(ListenerProfile.id.in_({c.listener_id for c in convos}))
        ).all()
    }
    return [
        ConversationListItem(
            id=c.id,
            status=c.status.value,
            listener_persona_name=(
                listeners[c.listener_id].persona_name if c.listener_id in listeners else "Listener"
            ),
            listener_persona_avatar=(
                listeners[c.listener_id].persona_avatar if c.listener_id in listeners else ""
            ),
            stream_channel_id=c.stream_channel_id,
            is_locked=c.is_locked,
            created_at=c.created_at.isoformat(),
            ended_at=c.ended_at.isoformat() if c.ended_at else None,
        )
        for c in convos
    ]


@router.get("/{convo_id}/mentor", response_model=ListenerProfileOut)
def conversation_mentor(
    convo_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ListenerProfileOut:
    """ "Two in the room" (spec §3.3), keyed by the conversation the member is in —
    the chat route only knows the conversation id, so the listener id never has to
    travel through route params. Opaque 404 for any conversation not this member's."""
    convo = _owned(db, convo_id, user_id)
    listener = db.get(ListenerProfile, convo.listener_id)
    if listener is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    return _profile_out(db, listener, user_id)


@router.post("/{convo_id}/verify-pin", response_model=OkResult)
def verify_conversation_pin(
    convo_id: str,
    payload: VerifyPinRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OkResult:
    """Open-gate for a locked chat: verifies the PIN WITHOUT unlocking, so the
    conversation stays protected the next time it's opened."""
    convo = _owned(db, convo_id, user_id)
    if not convo.is_locked:
        return OkResult(status="ok")
    _pin_attempt_guard(convo.id, user_id)
    if not verify_pin(payload.pin, convo.id, convo.pin_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "wrong PIN")
    return OkResult(status="ok")


# --- Options sheet: per-conversation controls ---
@router.post("/{convo_id}/lock", response_model=ConversationState)
def lock_conversation(
    convo_id: str,
    payload: LockRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ConversationState:
    """Lock the chat behind a 4-digit PIN. The PIN is hashed, never stored raw."""
    convo = _owned(db, convo_id, user_id)
    convo.pin_hash = hash_pin(payload.pin, convo.id)
    convo.is_locked = True
    db.commit()
    db.refresh(convo)
    return _state(convo)


@router.post("/{convo_id}/unlock", response_model=ConversationState)
def unlock_conversation(
    convo_id: str,
    payload: UnlockRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ConversationState:
    convo = _owned(db, convo_id, user_id)
    _pin_attempt_guard(convo.id, user_id)
    if not verify_pin(payload.pin, convo.id, convo.pin_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "incorrect PIN")
    convo.is_locked = False
    db.commit()
    db.refresh(convo)
    return _state(convo)


@router.post("/{convo_id}/status-mask", response_model=ConversationState)
def set_status_mask(
    convo_id: str,
    payload: StatusMaskRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ConversationState:
    """Panda Mask: present a chosen status to the other side (null clears it)."""
    convo = _owned(db, convo_id, user_id)
    convo.status_mask = payload.mask
    db.commit()
    db.refresh(convo)
    return _state(convo)


@router.post("/{convo_id}/pause", response_model=ConversationState)
def set_pause(
    convo_id: str,
    payload: PauseRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ConversationState:
    """Panda Pause: mute notifications for this conversation."""
    convo = _owned(db, convo_id, user_id)
    convo.is_paused = payload.paused
    db.commit()
    db.refresh(convo)
    return _state(convo)


@router.post("/{convo_id}/end", response_model=OkResult)
def end_conversation(
    convo_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OkResult:
    """End the chat. Messages are NOT deleted (this matches the in-app copy).
    Idempotent: ending an already-ended chat never double-releases the slot."""
    convo = _owned(db, convo_id, user_id, lock=True)
    conversations.end(db, convo, ConversationEndedBy.member)
    db.commit()
    return OkResult(status="ended")


@router.post("/{convo_id}/wipe", response_model=dict)
def wipe_conversation(
    convo_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> dict:
    """Panda Wipe: delete messages from BOTH sides — device AND our servers (Stream).
    Wiping an already-ended chat still wipes, but only an ACTIVE chat releases the
    listener's slot (it was already released when the chat ended)."""
    convo = _owned(db, convo_id, user_id, lock=True)
    if convo.stream_channel_id:
        stream.wipe_channel(convo.stream_channel_id)
    # Releases the slot only on the active → ended transition; an already-ended
    # chat keeps its original ended_at / ended_by.
    conversations.end(db, convo, ConversationEndedBy.member)
    if convo.ended_at is None:
        convo.ended_at = datetime.now(UTC)
        convo.ended_by = ConversationEndedBy.member
    convo.status = ConversationStatus.wiped
    db.commit()
    return {"status": "wiped", "deleted_from": ["device", "servers"]}


@router.post("/{convo_id}/reflection", response_model=OkResult)
def save_reflection(
    convo_id: str,
    payload: ReflectionIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OkResult:
    """Private end-of-conversation energy reflection (1 drained … 5 energized).

    Ownership is verified here and then dropped — the stored row carries only the
    conversation id and the value (no user id, no content, no points — T&S #5).
    Idempotent: re-submitting updates the single row for the conversation.
    """
    _owned(db, convo_id, user_id)
    existing = db.scalars(
        select(ConversationReflection).where(ConversationReflection.conversation_id == convo_id)
    ).first()
    if existing:
        existing.energy = payload.energy
    else:
        db.add(ConversationReflection(conversation_id=convo_id, energy=payload.energy))
    db.commit()
    return OkResult(status="ok")


# --- Report / Block (safety) ---
def _file_moderation_and_end(
    db: Session, convo: Conversation, user_id: str, reason: str | None, *, blocked: bool
) -> None:
    """Report/Block both file a moderation event (unreviewed → human queue) and end
    the chat (DoD: 'removes the chat and files a moderation event'). The caller holds
    the conversation row lock (a report racing the mentor's End must not release the
    slot twice, nor deadlock on the opposite lock order) and seals the Stream channel
    after its commit."""
    db.add(
        ModerationEvent(
            reporter_id=user_id,
            subject_id=convo.listener_id,
            conversation_id=convo.id,
            level=ModerationLevel.suspension if blocked else ModerationLevel.warning,
            reason=reason,
            blocked=blocked,
            reviewed=False,
        )
    )
    conversations.end(db, convo, ConversationEndedBy.member)


@router.post("/{convo_id}/report", response_model=OkResult)
def report_conversation(
    convo_id: str,
    payload: ReportRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OkResult:
    convo = _owned(db, convo_id, user_id, lock=True)
    _file_moderation_and_end(db, convo, user_id, payload.reason, blocked=False)
    channel_id = convo.stream_channel_id
    db.commit()
    conversations.seal(channel_id)
    return OkResult(status="reported")


@router.post("/{convo_id}/block", response_model=OkResult)
def block_conversation(
    convo_id: str,
    payload: ReportRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OkResult:
    """Block this listener: files a moderation event, ends the chat, and ensures the
    listener can never be re-matched to this user (enforced in services/matching)."""
    convo = _owned(db, convo_id, user_id, lock=True)
    _file_moderation_and_end(db, convo, user_id, payload.reason, blocked=True)
    channel_id = convo.stream_channel_id
    db.commit()
    conversations.seal(channel_id)
    return OkResult(status="blocked")
