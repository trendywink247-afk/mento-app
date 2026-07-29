"""Listener discovery + Personal (directed) requests (SCOPE §4/§5).

v1 listeners are anonymous personas — no real names, photos, or star ratings (T&S #7,
PRD: no star ratings). A Personal request carries an intro message into the mentor's
inbox; accept/decline is exposed behind the audited admin-console auth as the
stand-in for the deferred Module B mentor portal, so the full request lifecycle is
real and testable today without a mentor app.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.admin import AdminAccount
from app.models.enums import ListenerStatus, RequestKind, RequestStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.request import ConversationRequest
from app.routers.admin_console import current_admin
from app.schemas import ListenerOut, OkResult, PersonalRequestIn, RequestOut
from app.security import current_user_id
from app.services import audit
from app.services.matching import (
    ListenerAtCapacity,
    RequestNotPending,
    _blocked_listener_ids,
    _own_listener_ids,
    accept_personal_request,
    decline_personal_request,
)

router = APIRouter(prefix="/listeners", tags=["listeners"])


def _listener_out(li: ListenerProfile) -> ListenerOut:
    return ListenerOut(
        id=li.id,
        persona_name=li.persona_name,
        persona_avatar=li.persona_avatar,
        gender=li.gender.value,
        categories=li.categories or [],
        status=li.status.value,
        available=li.status == ListenerStatus.online
        and li.active_conversations < li.max_concurrent,
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
    own listener profile, if their application was approved), available first."""
    excluded = _blocked_listener_ids(db, user_id) | _own_listener_ids(db, user_id)
    listeners = db.scalars(
        select(ListenerProfile)
        .where(ListenerProfile.vetting_status == VettingStatus.approved)
        .order_by(ListenerProfile.rank.desc())
    ).all()
    out = [_listener_out(li) for li in listeners if li.id not in excluded]
    return sorted(out, key=lambda x: not x.available)


@router.post("/{listener_id}/request", response_model=RequestOut)
def create_personal_request(
    listener_id: str,
    payload: PersonalRequestIn,
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
    audit.record(db, admin, "personal_request.accept", subject_type="request", subject_id=request_id)
    db.commit()
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
    audit.record(db, admin, "personal_request.decline", subject_type="request", subject_id=request_id)
    db.commit()
    return OkResult(status="declined")
