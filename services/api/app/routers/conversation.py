"""Conversation lifecycle + options sheet (DECISIONS §H.2, PRD §6/§11).

Owner-only actions on a conversation: lock (PIN), status mask, pause notifications,
end, Panda Wipe (real server delete), report, block. Report and block both END the
conversation and file a moderation event; block additionally prevents that listener
from ever being re-matched to this user (see services/matching).
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import get_db
from app.models.conversation import Conversation
from app.models.enums import ConversationEndedBy, ConversationStatus, ModerationLevel
from app.models.listener import ListenerProfile
from app.models.moderation import ModerationEvent
from app.models.reflection import ConversationReflection
from app.schemas import (
    AllowanceOut,
    ConversationListItem,
    ConversationMentorOut,
    ConversationState,
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
from app.services import (
    allowance,
    categories,
    conversations,
    in_touch,
    listener_profiles,
    mentor_names,
    snooze,
    stream,
)

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


@router.get(
    "",
    response_model=list[ConversationListItem],
    dependencies=[Depends(mentor_names.fresh_names)],
)
def list_conversations(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[ConversationListItem]:
    """The user's conversations, newest first — the My Chats surface (#54/55).

    Rotating names (DECISIONS §L.6): a row shows the mentor's name TODAY while the chat
    is active or the member is in touch with them; an ended / wiped chat with anyone
    else keeps the name it ended under (tomorrow's name is what the member gets by
    asking to stay in touch, not for free). `first_met_as` = the name when this chat
    began, only when it differs from the one shown."""
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
    links = in_touch.in_touch_listener_ids(db, user_id)
    book = mentor_names.NameBook(db, listeners.keys())

    def shown_name(c: Conversation) -> str:
        li = listeners.get(c.listener_id)
        if li is None:
            return "Listener"
        if c.status == ConversationStatus.active or c.listener_id in links:
            return li.persona_name
        return book.name_at(c.listener_id, c.ended_at, li.persona_name)

    def first_met(c: Conversation) -> str | None:
        li = listeners.get(c.listener_id)
        if li is None:
            return None
        link = links.get(c.listener_id)
        first = (
            link.first_met_as
            if link
            else book.name_at(c.listener_id, c.created_at, li.persona_name)
        )
        return mentor_names.first_met_label(first, shown_name(c))

    return [
        ConversationListItem(
            id=c.id,
            status=c.status.value,
            listener_persona_name=shown_name(c),
            listener_persona_avatar=(
                listeners[c.listener_id].persona_avatar if c.listener_id in listeners else ""
            ),
            stream_channel_id=c.stream_channel_id,
            is_locked=c.is_locked,
            created_at=c.created_at.isoformat(),
            ended_at=c.ended_at.isoformat() if c.ended_at else None,
            issue_category=c.issue_category,
            issue_category_label=categories.label(c.issue_category),
            in_touch=c.listener_id in links,
            first_met_as=first_met(c),
            reply_within_a_day=snooze.is_snoozed(c),
        )
        for c in convos
    ]


@router.get(
    "/{convo_id}/mentor",
    response_model=ConversationMentorOut,
    dependencies=[Depends(mentor_names.fresh_names)],
)
def conversation_mentor(
    convo_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ConversationMentorOut:
    """ "Two in the room" (spec §3.3), keyed by the conversation the member is in —
    the chat route only knows the conversation id, so the listener id never has to
    travel through route params. Opaque 404 for any conversation not this member's."""
    convo = _owned(db, convo_id, user_id)
    listener = db.get(ListenerProfile, convo.listener_id)
    if listener is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    out = listener_profiles.profile(db, listener, user_id).model_dump()
    links = in_touch.in_touch_listener_ids(db, user_id)
    # An ended chat with a mentor the member is not in touch with keeps the name it
    # ended under — the same rule as list_conversations.
    out["persona_name"] = in_touch.name_for_conversation(
        db, convo, listener, linked=listener.id in links
    )
    if out.get("first_met_as") is None:
        book = mentor_names.NameBook(db, [listener.id])
        out["first_met_as"] = mentor_names.first_met_label(
            book.name_at(listener.id, convo.created_at, listener.persona_name),
            out["persona_name"],
        )
    return ConversationMentorOut(
        **out,
        issue_category=convo.issue_category,
        issue_category_label=categories.label(convo.issue_category),
        stay_in_touch=in_touch.standing(db, user_id, listener, convo),
        reply_within_a_day=snooze.is_snoozed(convo),
    )


@router.get("/{convo_id}/allowance", response_model=AllowanceOut)
def conversation_allowance(
    convo_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> AllowanceOut:
    """The member's message allowance in THIS conversation (DECISIONS §L.2) — so the
    composer can say "7 of 10 left today" and show the still note without guessing.
    Read-only; the counting itself happens in the Stream before-send hook. Opaque 404
    for a conversation that is not this member's."""
    convo = _owned(db, convo_id, user_id)
    return allowance.to_out(allowance.state_for(db, user_id, convo))


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
        db.commit()
        return OkResult(status="ok")
    db.add(ConversationReflection(conversation_id=convo_id, energy=payload.energy))
    try:
        db.commit()
    except IntegrityError:
        # A double tap raced us to uq_reflection_conversation — the row exists now;
        # last write wins, same as the sequential path.
        db.rollback()
        db.execute(
            update(ConversationReflection)
            .where(ConversationReflection.conversation_id == convo_id)
            .values(energy=payload.energy)
        )
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
    # A block or a report ends any stay-in-touch link (or waiting ask) between the two.
    in_touch.end_for_pair(db, user_id, convo.listener_id)


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
