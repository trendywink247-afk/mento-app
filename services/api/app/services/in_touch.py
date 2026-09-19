"""Stay in touch (DECISIONS §L.6–7): a member asks, the mentor answers, either may end it.

Rules kept here so no router can drift from them:

- Consent both ways. Only the MEMBER of a conversation can ask, only about THAT
  conversation's mentor; only that mentor can answer.
- At most `in_touch_limit` (2) places per member. A waiting ask HOLDS a place — so a
  mentor's "yes" can never be refused for room the member no longer has. The third ask
  is refused with the true reason (it keeps conversations unhurried and protects
  mentors' time). Nothing here may ever hint that more places can be bought (T&S #4).
- "Not now" is quiet: no reason is stored or shown, nothing counts against anyone, and
  the same member cannot ask that mentor again for `in_touch_reask_days` — the ask is
  one tap and never nags.
- A block, a report (either side's) or a suspension ends the link as `system`.
- No count of "how many people stay in touch with me" exists anywhere (T&S #5): the
  mentor side has a pending list and a per-conversation flag, never a roster.
- Payloads carry persona + companion only — never age, email or identity (T&S #7).

Lock order: member row (`locks.serialize_member`) → link row. Nothing takes them the
other way round.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import ApiProblem
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, LinkEndedBy, LinkStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.mentor_link import MentorLink
from app.schemas import InTouchSlots, StayInTouchOut
from app.services import locks
from app.services.matching import blocked_listener_ids, own_listener_ids
from app.services.mentor_names import NameBook, first_met_label, next_rotation_at

LIVE = (LinkStatus.pending, LinkStatus.accepted)

FULL_DETAIL = (
    "You can stay in touch with two mentors at a time. It keeps each conversation "
    "unhurried, and it protects their time. To make room for someone new, end one of "
    "these first."
)
WAITING_DETAIL = (
    "You have an ask still waiting for a reply, so both places are spoken for. "
    "You can take it back to make room."
)
COOLDOWN_DETAIL = "They said not now. You can ask again a little later."
UNAVAILABLE_DETAIL = "This mentor can't be reached right now."


@dataclass(frozen=True)
class Slots:
    limit: int
    in_touch: int
    waiting: int

    @property
    def free(self) -> int:
        return max(0, self.limit - self.in_touch - self.waiting)


@dataclass(frozen=True)
class MemberView:
    """What the member may know about themselves and ONE mentor."""

    state: str  # none | asked | in_touch | not_now
    link: MentorLink | None
    slots: Slots
    can_ask: bool
    blocked_reason: str | None
    can_ask_again_at: datetime | None


def slots_for(db: Session, user_id: str) -> Slots:
    rows = dict(
        db.execute(
            select(MentorLink.status, func.count())
            .where(MentorLink.user_id == user_id, MentorLink.status.in_(LIVE))
            .group_by(MentorLink.status)
        ).all()
    )
    return Slots(
        limit=get_settings().in_touch_limit,
        in_touch=rows.get(LinkStatus.accepted, 0),
        waiting=rows.get(LinkStatus.pending, 0),
    )


def live_link(db: Session, user_id: str, listener_id: str, *, lock: bool = False):
    stmt = select(MentorLink).where(
        MentorLink.user_id == user_id,
        MentorLink.listener_id == listener_id,
        MentorLink.status.in_(LIVE),
    )
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    return db.scalars(stmt).first()


def in_touch_listener_ids(db: Session, user_id: str) -> dict[str, MentorLink]:
    """listener id → the member's ACCEPTED link with them."""
    links = db.scalars(
        select(MentorLink).where(
            MentorLink.user_id == user_id, MentorLink.status == LinkStatus.accepted
        )
    ).all()
    return {link.listener_id: link for link in links}


def _last_decline(db: Session, user_id: str, listener_id: str) -> MentorLink | None:
    return db.scalars(
        select(MentorLink)
        .where(
            MentorLink.user_id == user_id,
            MentorLink.listener_id == listener_id,
            MentorLink.status == LinkStatus.declined,
        )
        .order_by(MentorLink.responded_at.desc())
    ).first()


def _reachable(db: Session, user_id: str, listener_id: str) -> bool:
    li = db.get(ListenerProfile, listener_id)
    if li is None or li.vetting_status != VettingStatus.approved:
        return False
    return listener_id not in (blocked_listener_ids(db, user_id) | own_listener_ids(db, user_id))


def member_view(
    db: Session, user_id: str, listener_id: str, now: datetime | None = None
) -> MemberView:
    now = now or datetime.now(UTC)
    slots = slots_for(db, user_id)
    link = live_link(db, user_id, listener_id)
    if link is not None:
        state = "in_touch" if link.status == LinkStatus.accepted else "asked"
        return MemberView(state, link, slots, False, None, None)
    if not _reachable(db, user_id, listener_id):
        return MemberView("none", None, slots, False, "unavailable", None)
    declined = _last_decline(db, user_id, listener_id)
    if declined is not None and declined.responded_at is not None:
        again = declined.responded_at + timedelta(days=get_settings().in_touch_reask_days)
        if again > now:
            return MemberView("not_now", declined, slots, False, "not_now_cooldown", again)
    if slots.free <= 0:
        reason = "in_touch_full" if slots.in_touch >= slots.limit else "in_touch_waiting"
        return MemberView("none", None, slots, False, reason, None)
    return MemberView("none", None, slots, True, None, None)


def _first_meeting(db: Session, user_id: str, listener: ListenerProfile) -> tuple[str, datetime]:
    """The mentor's name when these two FIRST talked, and when."""
    first_at = db.execute(
        select(func.min(Conversation.created_at)).where(
            Conversation.user_id == user_id, Conversation.listener_id == listener.id
        )
    ).scalar_one()
    first_at = first_at or datetime.now(UTC)
    book = NameBook(db, [listener.id])
    return book.name_at(listener.id, first_at, listener.persona_name), first_at


def ask(db: Session, user_id: str, convo: Conversation, now: datetime | None = None) -> MentorLink:
    """The member's one-tap ask. Idempotent: asking again while an ask is waiting (or
    while already in touch) returns that link. Commits."""
    now = now or datetime.now(UTC)
    locks.serialize_member(db, user_id)
    view = member_view(db, user_id, convo.listener_id, now)
    if view.link is not None and view.state in ("asked", "in_touch"):
        return view.link
    if not view.can_ask:
        if view.blocked_reason == "unavailable":
            raise ApiProblem(409, "mentor_unavailable", UNAVAILABLE_DETAIL)
        if view.blocked_reason == "not_now_cooldown":
            raise ApiProblem(
                409,
                "not_now_cooldown",
                COOLDOWN_DETAIL,
                can_ask_again_at=view.can_ask_again_at.isoformat(),
            )
        detail = FULL_DETAIL if view.blocked_reason == "in_touch_full" else WAITING_DETAIL
        raise ApiProblem(409, view.blocked_reason or "in_touch_full", detail)
    listener = db.get(ListenerProfile, convo.listener_id)
    first_name, first_at = _first_meeting(db, user_id, listener)
    link = MentorLink(
        user_id=user_id,
        listener_id=listener.id,
        conversation_id=convo.id,
        status=LinkStatus.pending,
        first_met_as=first_name,
        first_met_at=first_at,
    )
    db.add(link)
    try:
        db.commit()
    except IntegrityError:
        # Only without row locks (SQLite): a double tap raced the partial unique index.
        db.rollback()
        return live_link(db, user_id, convo.listener_id)
    db.refresh(link)
    return link


def _close(link: MentorLink, status: LinkStatus, by: LinkEndedBy, now: datetime) -> None:
    link.status = status
    link.ended_at = now
    link.ended_by = by


def take_back_or_end(db: Session, user_id: str, listener_id: str) -> str:
    """Member side, keyed by mentor: a waiting ask is taken back, an accepted link is
    ended. Idempotent — nothing live is still a success. Commits. Returns what happened."""
    now = datetime.now(UTC)
    locks.serialize_member(db, user_id)
    link = live_link(db, user_id, listener_id, lock=True)
    if link is None:
        db.rollback()
        return "none"
    if link.status == LinkStatus.pending:
        _close(link, LinkStatus.withdrawn, LinkEndedBy.member, now)
        outcome = "taken_back"
    else:
        _close(link, LinkStatus.ended, LinkEndedBy.member, now)
        outcome = "ended"
    db.commit()
    return outcome


def member_link(db: Session, user_id: str, link_id: str) -> MentorLink | None:
    link = db.get(MentorLink, link_id)
    return link if link is not None and link.user_id == user_id else None


def respond(
    db: Session, listener_id: str, link_id: str, *, accept: bool, now: datetime | None = None
) -> MentorLink | None:
    """The mentor's yes / not now. None = no such waiting ask for THIS mentor (opaque).
    Accepting never takes a seat (§L.6). Commits."""
    now = now or datetime.now(UTC)
    peek = db.get(MentorLink, link_id)
    if peek is None or peek.listener_id != listener_id:
        return None
    user_id = peek.user_id
    db.rollback()
    locks.serialize_member(db, user_id)
    link = db.execute(
        select(MentorLink)
        .where(MentorLink.id == link_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if link is None or link.listener_id != listener_id or link.status != LinkStatus.pending:
        db.rollback()
        return None
    if accept:
        if listener_id in blocked_listener_ids(db, user_id):
            # The member blocked this mentor after asking (the block path ends the
            # link, so this is belt and braces): never reconnect them.
            _close(link, LinkStatus.ended, LinkEndedBy.system, now)
            db.commit()
            return None
        if slots_for(db, user_id).in_touch >= get_settings().in_touch_limit:
            db.rollback()
            raise ApiProblem(409, "member_full", "They have no room to stay in touch right now.")
        link.status = LinkStatus.accepted
    else:
        link.status = LinkStatus.declined
    link.responded_at = now
    db.commit()
    db.refresh(link)
    return link


def end_by_listener(db: Session, listener_id: str, user_id: str) -> bool:
    """The mentor ends the link with one member (keyed from their conversation).
    Idempotent. Commits."""
    locks.serialize_member(db, user_id)
    link = live_link(db, user_id, listener_id, lock=True)
    if link is None or link.status != LinkStatus.accepted:
        db.rollback()
        return False
    _close(link, LinkStatus.ended, LinkEndedBy.listener, datetime.now(UTC))
    db.commit()
    return True


def end_for_pair(db: Session, user_id: str, listener_id: str) -> None:
    """A block or a report between these two ends whatever was live, as `system`.
    Does NOT commit — it rides in the caller's transaction with the moderation event."""
    link = live_link(db, user_id, listener_id, lock=True)
    if link is not None:
        _close(link, LinkStatus.ended, LinkEndedBy.system, datetime.now(UTC))


def end_all_for_listener(db: Session, listener_id: str) -> int:
    """Suspension: nobody stays in touch with a mentor the team has removed. Does NOT
    commit."""
    now = datetime.now(UTC)
    links = db.scalars(
        select(MentorLink)
        .where(MentorLink.listener_id == listener_id, MentorLink.status.in_(LIVE))
        .order_by(MentorLink.id)
        .with_for_update()
    ).all()
    for link in links:
        _close(link, LinkStatus.ended, LinkEndedBy.system, now)
    return len(links)


def pending_for_listener(db: Session, listener_id: str) -> list[MentorLink]:
    return list(
        db.scalars(
            select(MentorLink)
            .where(MentorLink.listener_id == listener_id, MentorLink.status == LinkStatus.pending)
            .order_by(MentorLink.created_at.asc())
            .limit(100)
        ).all()
    )


def listener_in_touch_user_ids(db: Session, listener_id: str, user_ids: set[str]) -> set[str]:
    """Which of THESE members (the mentor's own conversation partners) are in touch —
    a per-row flag, never a roster or a count."""
    if not user_ids:
        return set()
    return set(
        db.scalars(
            select(MentorLink.user_id).where(
                MentorLink.listener_id == listener_id,
                MentorLink.status == LinkStatus.accepted,
                MentorLink.user_id.in_(user_ids),
            )
        ).all()
    )


def slots_out(slots: Slots) -> InTouchSlots:
    return InTouchSlots(
        limit=slots.limit, in_touch=slots.in_touch, waiting=slots.waiting, free=slots.free
    )


def name_for_conversation(
    db: Session, convo: Conversation, listener: ListenerProfile, *, linked: bool
) -> str:
    """The ONE rule for which of a mentor's names a member sees on a conversation
    (DECISIONS §L.6): today's while the chat is active or the two are in touch;
    otherwise the name the chat ended under — never tomorrow's for free."""
    if convo.status == ConversationStatus.active or linked:
        return listener.persona_name
    return NameBook(db, [listener.id]).name_at(listener.id, convo.ended_at, listener.persona_name)


def standing(
    db: Session, user_id: str, listener: ListenerProfile, convo: Conversation
) -> StayInTouchOut:
    """The member's standing with one mentor, keyed by one of their conversations —
    served on its own and inside GET /conversations/{id}/mentor."""
    now = datetime.now(UTC)
    view = member_view(db, user_id, listener.id, now)
    live = view.link if view.state in ("asked", "in_touch") else None
    shown = name_for_conversation(db, convo, listener, linked=view.state == "in_touch")
    return StayInTouchOut(
        state=view.state,
        link_id=live.id if live else None,
        can_ask=view.can_ask,
        blocked_reason=view.blocked_reason,
        can_ask_again_at=view.can_ask_again_at.isoformat() if view.can_ask_again_at else None,
        slots=slots_out(view.slots),
        mentor_name=shown,
        first_met_as=first_met_label(live.first_met_as, shown) if live else None,
        first_met_at=live.first_met_at.isoformat() if live else None,
        names_change_at=next_rotation_at(now).isoformat(),
    )
