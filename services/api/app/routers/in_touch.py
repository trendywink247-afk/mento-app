"""Stay in touch (DECISIONS §L.6–7) — both sides of the consented link.

Member (session token):
  GET    /conversations/{id}/stay-in-touch   standing with this conversation's mentor
  POST   /conversations/{id}/stay-in-touch   ask (one tap, idempotent)
  DELETE /conversations/{id}/stay-in-touch   take the ask back / end the link
  GET    /in-touch                           the In touch view (+ asks still waiting)
  DELETE /in-touch/{link_id}                 the same take-back / end, keyed by link

Mentor (listener token):
  GET    /listener/me/stay-in-touch                       asks waiting for an answer
  POST   /listener/me/stay-in-touch/{id}/accept           "Yes, stay in touch"
  POST   /listener/me/stay-in-touch/{id}/not-now          quiet decline
  DELETE /listener/me/conversations/{id}/stay-in-touch    end it with that member

Every row is scoped to the caller and answers an opaque 404 otherwise. There is no
push for an ask ("they will see it next time they are here" — it never nags), and no
endpoint that lists or counts who stays in touch with a mentor (T&S #5).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import get_db
from app.models.conversation import Conversation
from app.models.enums import LinkStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.mentor_link import MentorLink
from app.models.user import User
from app.routers.listener_console import current_listener
from app.schemas import (
    InTouchItem,
    InTouchListOut,
    OkResult,
    StayInTouchAskItem,
    StayInTouchOut,
)
from app.security import current_user_id
from app.services import in_touch, mentor_names

router = APIRouter(tags=["stay-in-touch"])


def _owned(db: Session, convo_id: str, user_id: str) -> tuple[Conversation, ListenerProfile]:
    convo = db.get(Conversation, convo_id)
    if convo is None or convo.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    listener = db.get(ListenerProfile, convo.listener_id)
    if listener is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    return convo, listener


# --- member ----------------------------------------------------------------------


@router.get(
    "/conversations/{convo_id}/stay-in-touch",
    response_model=StayInTouchOut,
    dependencies=[Depends(mentor_names.fresh_names)],
)
def stay_in_touch_state(
    convo_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> StayInTouchOut:
    convo, listener = _owned(db, convo_id, user_id)
    return in_touch.standing(db, user_id, listener, convo)


@router.post(
    "/conversations/{convo_id}/stay-in-touch",
    response_model=StayInTouchOut,
    dependencies=[Depends(mentor_names.fresh_names)],
)
def ask_to_stay_in_touch(
    convo_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> StayInTouchOut:
    """One tap. Refusals are 409 with a `code`: `in_touch_full`, `in_touch_waiting`,
    `not_now_cooldown` (+ `can_ask_again_at`), `mentor_unavailable`."""
    ratelimit.enforce(
        f"stay-in-touch:{user_id}",
        10,
        3600,
        detail="That's a few asks in a short while — please give it a little time.",
    )
    convo, listener = _owned(db, convo_id, user_id)
    in_touch.ask(db, user_id, convo)
    return in_touch.standing(db, user_id, listener, convo)


@router.delete("/conversations/{convo_id}/stay-in-touch", response_model=StayInTouchOut)
def take_back_or_end(
    convo_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> StayInTouchOut:
    """A waiting ask is taken back; an accepted link is ended. Idempotent."""
    convo, listener = _owned(db, convo_id, user_id)
    in_touch.take_back_or_end(db, user_id, listener.id)
    return in_touch.standing(db, user_id, listener, convo)


def _item(
    link: MentorLink, li: ListenerProfile, convo: Conversation | None, state: str
) -> InTouchItem:
    return InTouchItem(
        link_id=link.id,
        state=state,
        listener_id=li.id,
        persona_name=li.persona_name,
        persona_avatar=li.persona_avatar,
        first_met_as=mentor_names.first_met_label(link.first_met_as, li.persona_name),
        first_met_at=link.first_met_at.isoformat(),
        since=link.responded_at.isoformat() if state == "in_touch" and link.responded_at else None,
        status=li.status.value,
        available=li.status == ListenerStatus.online
        and li.active_conversations < li.max_concurrent,
        categories=li.categories or [],
        community_slug=li.community_slug,
        public_line=li.public_line,
        availability_note=li.availability_note,
        conversation_id=convo.id if convo else None,
        conversation_status=convo.status.value if convo else None,
        stream_channel_id=convo.stream_channel_id if convo else None,
    )


@router.get(
    "/in-touch",
    response_model=InTouchListOut,
    dependencies=[Depends(mentor_names.fresh_names)],
)
def my_in_touch(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> InTouchListOut:
    """The In touch view: mentors who said yes (oldest link first — the order never
    reshuffles under the member), plus asks still waiting. At most `limit` rows in all."""
    links = db.scalars(
        select(MentorLink)
        .where(MentorLink.user_id == user_id, MentorLink.status.in_(in_touch.LIVE))
        .order_by(MentorLink.created_at.asc())
    ).all()
    listener_ids = {link.listener_id for link in links}
    listeners = {
        li.id: li
        for li in db.scalars(
            select(ListenerProfile).where(
                ListenerProfile.id.in_(listener_ids),
                ListenerProfile.vetting_status == VettingStatus.approved,
            )
        ).all()
    }
    latest: dict[str, Conversation] = {}
    if listener_ids:
        for convo in db.scalars(
            select(Conversation)
            .where(Conversation.user_id == user_id, Conversation.listener_id.in_(listener_ids))
            .order_by(Conversation.created_at.asc())
        ).all():
            latest[convo.listener_id] = convo  # ascending → the last one wins
    items: list[InTouchItem] = []
    waiting: list[InTouchItem] = []
    for link in links:
        li = listeners.get(link.listener_id)
        if li is None:
            continue
        if link.status == LinkStatus.accepted:
            items.append(_item(link, li, latest.get(li.id), "in_touch"))
        else:
            waiting.append(_item(link, li, latest.get(li.id), "asked"))
    return InTouchListOut(
        slots=in_touch.slots_out(in_touch.slots_for(db, user_id)), items=items, waiting=waiting
    )


@router.delete("/in-touch/{link_id}", response_model=OkResult)
def end_link(
    link_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OkResult:
    link = in_touch.member_link(db, user_id, link_id)
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    listener_id = link.listener_id
    db.rollback()
    outcome = in_touch.take_back_or_end(db, user_id, listener_id)
    return OkResult(status=outcome)


# --- mentor ----------------------------------------------------------------------


@router.get("/listener/me/stay-in-touch", response_model=list[StayInTouchAskItem])
def waiting_asks(
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> list[StayInTouchAskItem]:
    links = in_touch.pending_for_listener(db, listener.id)
    members = {
        u.id: u
        for u in db.scalars(select(User).where(User.id.in_({link.user_id for link in links}))).all()
    }
    return [
        StayInTouchAskItem(
            id=link.id,
            member_persona_name=members[link.user_id].persona_name,
            member_persona_avatar=members[link.user_id].persona_avatar,
            companion_animal=members[link.user_id].companion_animal,
            companion_colour=members[link.user_id].companion_colour,
            conversation_id=link.conversation_id,
            asked_at=link.created_at.isoformat(),
        )
        for link in links
        if link.user_id in members
    ]


def _respond(db: Session, listener: ListenerProfile, link_id: str, *, accept: bool) -> OkResult:
    ratelimit.enforce(
        f"stay-in-touch-answer:{listener.id}",
        60,
        3600,
        detail="Too many answers in a short while — please try again in a bit.",
    )
    listener_id = listener.id
    link = in_touch.respond(db, listener_id, link_id, accept=accept)
    if link is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ask not found")
    return OkResult(status="in_touch" if accept else "not_now")


@router.post("/listener/me/stay-in-touch/{link_id}/accept", response_model=OkResult)
def accept_ask(
    link_id: str,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> OkResult:
    """Never takes a seat — a mentor at capacity can still say yes (§L.6)."""
    return _respond(db, listener, link_id, accept=True)


@router.post("/listener/me/stay-in-touch/{link_id}/not-now", response_model=OkResult)
def not_now(
    link_id: str,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> OkResult:
    """Quiet: no reason is asked for, stored or shown; nothing counts against anyone."""
    return _respond(db, listener, link_id, accept=False)


@router.delete("/listener/me/conversations/{convo_id}/stay-in-touch", response_model=OkResult)
def mentor_ends_link(
    convo_id: str,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> OkResult:
    convo = db.get(Conversation, convo_id)
    if convo is None or convo.listener_id != listener.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    user_id, listener_id = convo.user_id, listener.id
    db.rollback()
    in_touch.end_by_listener(db, listener_id, user_id)
    return OkResult(status="ended")
