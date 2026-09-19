"""Listener discovery + Personal (directed) requests (SCOPE §4/§5).

v1 listeners are anonymous personas — no real names, photos, or star ratings (T&S #7,
PRD: no star ratings). A Personal request carries an intro message into the mentor's
inbox; accept/decline is exposed behind the audited admin-console auth as the
stand-in for the deferred Module B mentor portal, so the full request lifecycle is
real and testable today without a mentor app.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import get_db
from app.models.admin import AdminAccount
from app.models.enums import (
    RequestKind,
    RequestStatus,
    VettingStatus,
)
from app.models.favourite import FavouriteListener
from app.models.listener import ListenerProfile
from app.models.request import ConversationRequest
from app.routers.admin_console import current_admin
from app.schemas import ListenerOut, ListenerProfileOut, OkResult, PersonalRequestIn, RequestOut
from app.security import current_user_id
from app.services import (
    audit,
    in_touch,
    listener_profiles,
    locks,
    mentor_face,
    mentor_names,
    open_question,
    push_tasks,
)
from app.services.matching import (
    ListenerAtCapacity,
    RequestNotPending,
    accept_personal_request,
    blocked_listener_ids,
    decline_personal_request,
    own_listener_ids,
)

router = APIRouter(prefix="/listeners", tags=["listeners"])


def _request_out(r: ConversationRequest, db: Session) -> RequestOut:
    target = db.get(ListenerProfile, r.target_listener_id) if r.target_listener_id else None
    animal, colour = mentor_face.face(target) if target is not None else (None, None)
    return RequestOut(
        id=r.id,
        status=r.status.value,
        target_listener_id=r.target_listener_id,
        intro_message=r.intro_message,
        conversation_id=r.conversation_id,
        created_at=r.created_at.isoformat(),
        seen_at=r.seen_at.isoformat() if r.seen_at else None,
        replying=r.status == RequestStatus.matched,
        listener_companion_animal=animal,
        listener_companion_colour=colour,
    )


@router.get("", response_model=list[ListenerOut], dependencies=[Depends(mentor_names.fresh_names)])
def list_listeners(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> list[ListenerOut]:
    """Approved listeners (minus anyone this user blocked — and minus the user's
    own listener profile, if their application was approved). Ordered IN TOUCH first
    (DECISIONS §L.7 — the consented link that replaces the favourite), then the
    deprecated favourites, then available, then rank (spec 2026-09-06 §3.4) — each a
    stable sort over the previous so rank order survives within every group."""
    excluded = blocked_listener_ids(db, user_id) | own_listener_ids(db, user_id)
    listeners = db.scalars(
        select(ListenerProfile)
        .where(ListenerProfile.vetting_status == VettingStatus.approved)
        .order_by(ListenerProfile.rank.desc())
    ).all()
    favourite_ids = set(
        db.scalars(
            select(FavouriteListener.listener_id).where(FavouriteListener.user_id == user_id)
        ).all()
    )
    links = in_touch.in_touch_listener_ids(db, user_id)
    out = [
        listener_profiles.card(li, is_favourite=li.id in favourite_ids, link=links.get(li.id))
        for li in listeners
        if li.id not in excluded
    ]
    out = sorted(out, key=lambda x: not x.available)
    out = sorted(out, key=lambda x: not x.is_favourite)
    return sorted(out, key=lambda x: not x.in_touch)


def _visible_approved_listener(db: Session, listener_id: str, user_id: str) -> ListenerProfile:
    """An approved listener that isn't blocked by, or owned by, this user — the
    same opaque 404 as the Personal-request path (T&S #7: don't leak *why*)."""
    li = db.get(ListenerProfile, listener_id)
    if li is None or li.vetting_status != VettingStatus.approved:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    if listener_id in blocked_listener_ids(db, user_id) | own_listener_ids(db, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    return li


@router.get(
    "/{listener_id}",
    response_model=ListenerProfileOut,
    dependencies=[Depends(mentor_names.fresh_names)],
)
def get_listener_profile(
    listener_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ListenerProfileOut:
    """Browse profile — "Two in the room" (spec §3.3), by listener id."""
    li = _visible_approved_listener(db, listener_id, user_id)
    return listener_profiles.profile(db, li, user_id)


@router.post("/{listener_id}/favourite", response_model=OkResult, deprecated=True)
def favourite_listener(
    listener_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OkResult:
    """DEPRECATED (DECISIONS §L.6): replaced by the consented stay-in-touch ask
    (`POST /conversations/{id}/stay-in-touch`). Kept so shipped builds keep working.

    Idempotent: a second POST is a no-op, not a second row (spec §3.4).

    Check-then-insert has a TOCTOU gap under concurrency (two racing POSTs can
    both pass the `is None` check); the primary key makes the loser's insert an
    IntegrityError, which is exactly the "already favourited" outcome we want —
    swallow it the same way services/safety.py dedupes a raced SafetyFlag.
    """
    _visible_approved_listener(db, listener_id, user_id)
    if db.get(FavouriteListener, {"user_id": user_id, "listener_id": listener_id}) is None:
        db.add(FavouriteListener(user_id=user_id, listener_id=listener_id))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
    return OkResult(status="favourited")


@router.delete("/{listener_id}/favourite", response_model=OkResult, deprecated=True)
def unfavourite_listener(
    listener_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OkResult:
    """DEPRECATED with the favourite (DECISIONS §L.6).

    Idempotent: unfavouriting something never favourited is still a 200.

    Deliberately NOT gated by `_visible_approved_listener` — a member who
    favourited a mentor and later blocked them must still be able to remove the
    favourite even though the mentor is no longer "visible" to them. 404 only
    when the listener id doesn't exist at all.
    """
    if db.get(ListenerProfile, listener_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    row = db.get(FavouriteListener, {"user_id": user_id, "listener_id": listener_id})
    if row is not None:
        db.delete(row)
        db.commit()
    return OkResult(status="unfavourited")


@router.post("/{listener_id}/request", response_model=RequestOut)
def create_personal_request(
    listener_id: str,
    payload: PersonalRequestIn,
    background: BackgroundTasks,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> RequestOut:
    """Directed request: intro message → the mentor's inbox (pending until accepted)."""
    # Every new request pages a volunteer's phone — the same reasoning as the match
    # limit: a loop here is a denial of service against actual people.
    ratelimit.enforce(
        f"personal-request:{user_id}",
        10,
        3600,
        detail="You've sent several requests — please give mentors a little time to reply.",
    )
    listener = db.get(ListenerProfile, listener_id)
    if listener is None or listener.vetting_status != VettingStatus.approved:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    # Blocked listeners and the user's own listener profile are equally
    # unreachable — same opaque refusal for both.
    if listener_id in blocked_listener_ids(db, user_id) | own_listener_ids(db, user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "listener unavailable")

    # One pending request per pair: a double tap must wait for the first insert,
    # or the mentor gets two inbox rows and two pushes.
    locks.serialize_member(db, user_id)
    existing = db.scalars(
        select(ConversationRequest).where(
            ConversationRequest.requester_id == user_id,
            ConversationRequest.target_listener_id == listener_id,
            ConversationRequest.status == RequestStatus.pending,
        )
    ).first()
    if existing:
        return _request_out(existing, db)  # one pending request per pair — idempotent
    # One open question at a time: a question still waiting on ANOTHER mentor holds this
    # one back — unless this mentor is in touch with the member, or the crisis scan flagged
    # the member recently (services/open_question.py).
    open_question.enforce(db, user_id, target_listener_id=listener_id)

    req = ConversationRequest(
        kind=RequestKind.personal,
        status=RequestStatus.pending,
        requester_id=user_id,
        target_listener_id=listener_id,
        issue_category=payload.issue_category,
        intro_message=payload.intro_message,
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    background.add_task(push_tasks.notify_request_created_safe, req.id)
    return _request_out(req, db)


@router.get("/requests/mine", response_model=list[RequestOut])
def my_requests(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[RequestOut]:
    reqs = db.scalars(
        select(ConversationRequest)
        .where(ConversationRequest.requester_id == user_id)
        .order_by(ConversationRequest.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [_request_out(r, db) for r in reqs]


@router.delete("/requests/{request_id}", response_model=RequestOut)
def withdraw_my_request(
    request_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> RequestOut:
    """The member closes their own open question ("You can ask another once they reply or
    you close it"). Idempotent: a request already answered or closed comes back as it is —
    a withdrawal never undoes a mentor's yes. 404 for anyone else's request (opaque)."""
    locks.serialize_member(db, user_id)
    req = db.execute(
        select(ConversationRequest)
        .where(ConversationRequest.id == request_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if req is None or req.requester_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "request not found")
    if req.status == RequestStatus.pending:
        req.status = RequestStatus.expired
        db.commit()
        db.refresh(req)
    return _request_out(req, db)


@router.post("/requests/{request_id}/accept", response_model=RequestOut)
def accept_request(
    request_id: str,
    background: BackgroundTasks,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> RequestOut:
    """Mentor-inbox accept (admin-console stand-in; the listener console is the real
    surface). Row-locked capacity path shared via services.matching."""
    try:
        req = accept_personal_request(db, request_id)
    except RequestNotPending:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pending request not found") from None
    except ListenerAtCapacity:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "listener has no capacity right now"
        ) from None
    audit.record(
        db, admin, "personal_request.accept", subject_type="request", subject_id=request_id
    )
    db.commit()
    background.add_task(push_tasks.notify_request_accepted_safe, request_id)
    return _request_out(req, db)


@router.post("/requests/{request_id}/decline", response_model=OkResult)
def decline_request(
    request_id: str,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> OkResult:
    try:
        decline_personal_request(db, request_id)
    except RequestNotPending:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pending request not found") from None
    audit.record(
        db, admin, "personal_request.decline", subject_type="request", subject_id=request_id
    )
    db.commit()
    return OkResult(status="declined")
