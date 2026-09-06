"""Listener discovery + Personal (directed) requests (SCOPE §4/§5).

v1 listeners are anonymous personas — no real names, photos, or star ratings (T&S #7,
PRD: no star ratings). A Personal request carries an intro message into the mentor's
inbox; accept/decline is exposed behind the audited admin-console auth as the
stand-in for the deferred Module B mentor portal, so the full request lifecycle is
real and testable today without a mentor app.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.admin import AdminAccount
from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    ListenerStatus,
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
from app.services import audit, push_tasks
from app.services.matching import (
    ListenerAtCapacity,
    RequestNotPending,
    _blocked_listener_ids,
    _own_listener_ids,
    accept_personal_request,
    decline_personal_request,
)

router = APIRouter(prefix="/listeners", tags=["listeners"])

# Conversation statuses that count toward "conversations held" on a mentor
# profile — spec 2026-09-06 §3.3: the count is about the mentor's experience,
# so a wiped conversation (member-side hard delete) still counts.
_HELD_STATUSES = (ConversationStatus.active, ConversationStatus.ended, ConversationStatus.wiped)


def _is_favourite(db: Session, user_id: str, listener_id: str) -> bool:
    return db.get(FavouriteListener, {"user_id": user_id, "listener_id": listener_id}) is not None


def _listener_out(li: ListenerProfile, *, is_favourite: bool = False) -> ListenerOut:
    return ListenerOut(
        id=li.id,
        persona_name=li.persona_name,
        persona_avatar=li.persona_avatar,
        gender=li.gender.value,
        categories=li.categories or [],
        status=li.status.value,
        available=li.status == ListenerStatus.online
        and li.active_conversations < li.max_concurrent,
        is_favourite=is_favourite,
    )


def _profile_out(db: Session, li: ListenerProfile, user_id: str) -> ListenerProfileOut:
    """The full "Two in the room" profile (spec §3.3). Shared by the by-id (Browse)
    and by-conversation (chat header) routes."""
    conversations_held = db.scalar(
        select(func.count())
        .select_from(Conversation)
        .where(Conversation.listener_id == li.id, Conversation.status.in_(_HELD_STATUSES))
    )
    return ListenerProfileOut(
        id=li.id,
        persona_name=li.persona_name,
        persona_avatar=li.persona_avatar,
        gender=li.gender.value,
        categories=li.categories or [],
        community_slug=li.community_slug,
        status=li.status.value,
        available=li.status == ListenerStatus.online
        and li.active_conversations < li.max_concurrent,
        public_line=li.public_line,
        availability_note=li.availability_note,
        listening_since=li.created_at.date().isoformat(),
        conversations_held=conversations_held or 0,
        is_favourite=_is_favourite(db, user_id, li.id),
    )


def _request_out(r: ConversationRequest) -> RequestOut:
    return RequestOut(
        id=r.id,
        status=r.status.value,
        target_listener_id=r.target_listener_id,
        intro_message=r.intro_message,
        conversation_id=r.conversation_id,
        created_at=r.created_at.isoformat(),
    )


@router.get("", response_model=list[ListenerOut])
def list_listeners(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> list[ListenerOut]:
    """Approved listeners (minus anyone this user blocked — and minus the user's
    own listener profile, if their application was approved). Ordered favourites
    first, then available first, then rank (spec 2026-09-06 §3.4) — each a stable
    sort over the previous so rank order survives within every group."""
    excluded = _blocked_listener_ids(db, user_id) | _own_listener_ids(db, user_id)
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
    out = [
        _listener_out(li, is_favourite=li.id in favourite_ids)
        for li in listeners
        if li.id not in excluded
    ]
    out = sorted(out, key=lambda x: not x.available)
    return sorted(out, key=lambda x: not x.is_favourite)


def _visible_approved_listener(db: Session, listener_id: str, user_id: str) -> ListenerProfile:
    """An approved listener that isn't blocked by, or owned by, this user — the
    same opaque 404 as the Personal-request path (T&S #7: don't leak *why*)."""
    li = db.get(ListenerProfile, listener_id)
    if li is None or li.vetting_status != VettingStatus.approved:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    if listener_id in _blocked_listener_ids(db, user_id) | _own_listener_ids(db, user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    return li


@router.get("/{listener_id}", response_model=ListenerProfileOut)
def get_listener_profile(
    listener_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ListenerProfileOut:
    """Browse profile — "Two in the room" (spec §3.3), by listener id."""
    li = _visible_approved_listener(db, listener_id, user_id)
    return _profile_out(db, li, user_id)


@router.post("/{listener_id}/favourite", response_model=OkResult)
def favourite_listener(
    listener_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OkResult:
    """Idempotent: a second POST is a no-op, not a second row (spec §3.4)."""
    _visible_approved_listener(db, listener_id, user_id)
    if db.get(FavouriteListener, {"user_id": user_id, "listener_id": listener_id}) is None:
        db.add(FavouriteListener(user_id=user_id, listener_id=listener_id))
        db.commit()
    return OkResult(status="favourited")


@router.delete("/{listener_id}/favourite", response_model=OkResult)
def unfavourite_listener(
    listener_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OkResult:
    """Idempotent: unfavouriting something never favourited is still a 200."""
    _visible_approved_listener(db, listener_id, user_id)
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
    listener = db.get(ListenerProfile, listener_id)
    if listener is None or listener.vetting_status != VettingStatus.approved:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    # Blocked listeners and the user's own listener profile are equally
    # unreachable — same opaque refusal for both.
    if listener_id in _blocked_listener_ids(db, user_id) | _own_listener_ids(db, user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "listener unavailable")

    existing = db.scalars(
        select(ConversationRequest).where(
            ConversationRequest.requester_id == user_id,
            ConversationRequest.target_listener_id == listener_id,
            ConversationRequest.status == RequestStatus.pending,
        )
    ).first()
    if existing:
        return _request_out(existing)  # one pending request per pair — idempotent

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
    return _request_out(req)


@router.get("/requests/mine", response_model=list[RequestOut])
def my_requests(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> list[RequestOut]:
    reqs = db.scalars(
        select(ConversationRequest)
        .where(ConversationRequest.requester_id == user_id)
        .order_by(ConversationRequest.created_at.desc())
    ).all()
    return [_request_out(r) for r in reqs]


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
    return _request_out(req)


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
