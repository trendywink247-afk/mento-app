"""One open question at a time (recovered-call item 6; DECISIONS §L.7; board A24 / A04:
"One question goes to one mentor at a time").

A member's *open question* is a Personal request still waiting on a mentor they are NOT in
touch with. While one is open, the member cannot start a new ask to a stranger:

- `POST /match` (General, "Next available") answers 409 `question_open`;
- `POST /listeners/{id}/request` to ANOTHER mentor answers 409 `question_open` (the same
  mentor stays idempotent — the existing request comes back).

What the rule never touches:

- writing to an **in-touch** mentor (§L.7: "the one-open-question rule governs *new* asks
  to strangers") — a request to them is allowed, and a request waiting on them is not an
  open question either;
- conversations that already exist — the rule is about opening, never about talking;
- **the crisis path**: a member the crisis scan flagged in the last
  `allowance_crisis_exempt_hours` (24 h, the same window the message allowance uses) is
  never held back from reaching a person (T&S #1: a person in crisis is helped out, not
  rationed);
- a request to a mentor who is no longer reachable (suspended, or blocked by the member)
  does not count — nothing can answer it, so it cannot hold the member.

The member closes an open question with `DELETE /listeners/requests/{id}` (status becomes
`expired` — the existing terminal state; the enum has no "withdrawn" and this lane adds no
migration).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import ApiProblem
from app.models.enums import RequestKind, RequestStatus, SafetySignal, VettingStatus
from app.models.listener import ListenerProfile
from app.models.request import ConversationRequest
from app.models.safety import SafetyFlag
from app.services import in_touch
from app.services.matching import blocked_listener_ids

CODE = "question_open"


@dataclass(frozen=True)
class OpenQuestion:
    request: ConversationRequest
    mentor: ListenerProfile


def recently_flagged(db: Session, user_id: str, now: datetime | None = None) -> bool:
    """True when the crisis scan flagged this member within the exempt window."""
    hours = get_settings().allowance_crisis_exempt_hours
    if hours <= 0:
        return False
    now = now or datetime.now(UTC)
    return (
        db.execute(
            select(SafetyFlag.id)
            .where(
                SafetyFlag.user_id == user_id,
                SafetyFlag.signal != SafetySignal.none,
                SafetyFlag.created_at >= now - timedelta(hours=hours),
            )
            .limit(1)
        ).first()
        is not None
    )


def find(db: Session, user_id: str, *, besides: str | None = None) -> OpenQuestion | None:
    """The member's oldest open question, ignoring one aimed at `besides` (a listener id)."""
    pending = db.scalars(
        select(ConversationRequest)
        .where(
            ConversationRequest.requester_id == user_id,
            ConversationRequest.kind == RequestKind.personal,
            ConversationRequest.status == RequestStatus.pending,
            ConversationRequest.target_listener_id.is_not(None),
        )
        .order_by(ConversationRequest.created_at.asc())
    ).all()
    if not pending:
        return None
    linked = in_touch.in_touch_listener_ids(db, user_id)
    blocked = blocked_listener_ids(db, user_id)
    for req in pending:
        target = req.target_listener_id
        if target is None or target == besides or target in linked or target in blocked:
            continue
        mentor = db.get(ListenerProfile, target)
        if mentor is None or mentor.vetting_status != VettingStatus.approved:
            continue
        return OpenQuestion(request=req, mentor=mentor)
    return None


def detail(mentor_name: str) -> str:
    return (
        f"You have a question open with {mentor_name}. "
        "You can ask another once they reply or you close it."
    )


def enforce(db: Session, user_id: str, *, target_listener_id: str | None = None) -> None:
    """Refuse a new ask to a stranger while a question is open (409 `question_open`).

    `target_listener_id` is the mentor a Personal request is aimed at (None for General):
    an in-touch mentor is always reachable, and the crisis path is never held."""
    if target_listener_id is not None and target_listener_id in in_touch.in_touch_listener_ids(
        db, user_id
    ):
        return
    found = find(db, user_id, besides=target_listener_id)
    if found is None:
        return
    if recently_flagged(db, user_id):
        return
    raise ApiProblem(
        409,
        CODE,
        detail(found.mentor.persona_name),
        request_id=found.request.id,
        listener_id=found.mentor.id,
        mentor_name=found.mentor.persona_name,
        mentor_avatar=found.mentor.persona_avatar,
    )
