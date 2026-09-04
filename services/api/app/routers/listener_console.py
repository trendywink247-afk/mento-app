"""Minimal listener console (DECISIONS §I.6) — the surface where a REAL human
listener answers chats before the Module B portal exists.

Auth: a role-claimed JWT from scripts/issue_listener_token (shared as a link, no
password). Revocation is the per-request vetting check below: flip a listener to
suspended and every outstanding link dies instantly.

Anonymity holds on both sides (T&S #7): the listener sees member PERSONAS only,
and none of the member's privacy controls (lock/mask/PIN are the member's).
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ratelimit
from app.config import get_settings
from app.db import get_db
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, RequestStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.request import ConversationRequest
from app.models.user import User
from app.schemas import (
    DevListenerItem,
    DevTokenOut,
    ListenerConversationItem,
    ListenerMeOut,
    ListenerRequestItem,
    ListenerStatusIn,
    OkResult,
    RequestOut,
)
from app.security import current_listener_id, issue_listener_token
from app.services import stream
from app.services.matching import (
    ListenerAtCapacity,
    RequestNotPending,
    accept_personal_request,
    decline_personal_request,
)

router = APIRouter(prefix="/listener", tags=["listener-console"])


def current_listener(
    listener_id: str = Depends(current_listener_id),
    db: Session = Depends(get_db),
) -> ListenerProfile:
    """Load the authenticated listener; approval is checked on EVERY request so
    suspension revokes all outstanding token links immediately."""
    listener = db.get(ListenerProfile, listener_id)
    if listener is None or listener.vetting_status != VettingStatus.approved:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "listener access revoked")
    return listener


def _me_out(li: ListenerProfile) -> ListenerMeOut:
    return ListenerMeOut(
        id=li.id,
        persona_name=li.persona_name,
        persona_avatar=li.persona_avatar,
        status=li.status.value,
        categories=li.categories or [],
        active_conversations=li.active_conversations,
        max_concurrent=li.max_concurrent,
        stream_token=stream.user_token(li.id),
    )


# --- Dev-only convenience: pick a listener without a token link ---------------
# The console is token-link-authed by design (no login, for anonymity — DECISIONS
# §I.6). That's correct for production but a chore while testing. These two routes
# let a developer open /listener and click a seeded listener to enter. They 404
# outside dev (settings.env != "dev"), so the production auth story is untouched.


def _require_dev() -> None:
    if not get_settings().is_dev:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")


@router.get(
    "/dev/roster",
    response_model=list[DevListenerItem],
    dependencies=[Depends(_require_dev)],
)
def dev_roster(db: Session = Depends(get_db)) -> list[DevListenerItem]:
    rows = (
        db.execute(
            select(ListenerProfile)
            .where(ListenerProfile.vetting_status == VettingStatus.approved)
            .order_by(ListenerProfile.persona_name.asc())
        )
        .scalars()
        .all()
    )
    return [
        DevListenerItem(
            id=li.id,
            persona_name=li.persona_name,
            persona_avatar=li.persona_avatar,
            status=li.status.value,
        )
        for li in rows
    ]


@router.post(
    "/dev/token/{listener_id}",
    response_model=DevTokenOut,
    dependencies=[Depends(_require_dev)],
)
def dev_token(listener_id: str, db: Session = Depends(get_db)) -> DevTokenOut:
    listener = db.get(ListenerProfile, listener_id)
    if listener is None or listener.vetting_status != VettingStatus.approved:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    return DevTokenOut(token=issue_listener_token(listener.id))


@router.get("/me", response_model=ListenerMeOut)
def me(listener: ListenerProfile = Depends(current_listener)) -> ListenerMeOut:
    return _me_out(listener)


@router.patch("/me/status", response_model=ListenerMeOut)
def set_status(
    payload: ListenerStatusIn,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> ListenerMeOut:
    """online/away — directly gates General matching (its query filters on online)."""
    ratelimit.enforce(
        f"listener-status:{listener.id}",
        30,
        600,
        detail="Too many status changes — try again in a few minutes.",
    )
    listener.status = ListenerStatus(payload.status)
    if listener.status == ListenerStatus.online:
        # Tracking (re)starts with the next heartbeat — see matching.sweep_stale_presence.
        listener.last_seen_at = None
    db.commit()
    db.refresh(listener)
    return _me_out(listener)


@router.post("/me/heartbeat", response_model=OkResult)
def heartbeat(
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> OkResult:
    """Native console presence pulse (every 5 min while focused + online). The
    sweep in services/matching marks a listener away 15 min after the last one."""
    ratelimit.enforce(
        f"listener-heartbeat:{listener.id}", 30, 600, detail="Slow down — heartbeat limit reached."
    )
    listener.last_seen_at = datetime.now(UTC)
    db.commit()
    return OkResult(status="ok")


@router.get("/me/conversations", response_model=list[ListenerConversationItem])
def my_conversations(
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> list[ListenerConversationItem]:
    rows = db.execute(
        select(Conversation, User)
        .join(User, User.id == Conversation.user_id)
        .where(Conversation.listener_id == listener.id)
        .order_by(Conversation.created_at.desc())
    ).all()
    items = [
        ListenerConversationItem(
            id=convo.id,
            status=convo.status.value,
            user_persona_name=user.persona_name,
            user_persona_avatar=user.persona_avatar,
            stream_channel_id=convo.stream_channel_id,
            member_masked=convo.status_mask is not None,
            created_at=convo.created_at.isoformat(),
            ended_at=convo.ended_at.isoformat() if convo.ended_at else None,
        )
        for convo, user in rows
    ]
    # Active first, newest within each group.
    return sorted(items, key=lambda i: i.status != ConversationStatus.active.value)


@router.get("/me/requests", response_model=list[ListenerRequestItem])
def my_pending_requests(
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> list[ListenerRequestItem]:
    rows = db.execute(
        select(ConversationRequest, User)
        .join(User, User.id == ConversationRequest.requester_id)
        .where(
            ConversationRequest.target_listener_id == listener.id,
            ConversationRequest.status == RequestStatus.pending,
        )
        .order_by(ConversationRequest.created_at.asc())
    ).all()
    return [
        ListenerRequestItem(
            id=req.id,
            intro_message=req.intro_message,
            issue_category=req.issue_category,
            requester_persona_name=user.persona_name,
            created_at=req.created_at.isoformat(),
        )
        for req, user in rows
    ]


@router.post("/me/requests/{request_id}/accept", response_model=RequestOut)
def accept(
    request_id: str,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> RequestOut:
    """Same row-locked capacity path as General matching — no double-assignment."""
    try:
        req = accept_personal_request(db, request_id, acting_listener_id=listener.id)
    except RequestNotPending:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pending request not found") from None
    except ListenerAtCapacity:
        raise HTTPException(status.HTTP_409_CONFLICT, "you're at capacity right now") from None
    return RequestOut(
        id=req.id,
        status=req.status.value,
        target_listener_id=req.target_listener_id,
        intro_message=req.intro_message,
        conversation_id=req.conversation_id,
        created_at=req.created_at.isoformat(),
    )


@router.post("/me/requests/{request_id}/decline", response_model=OkResult)
def decline(
    request_id: str,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> OkResult:
    try:
        decline_personal_request(db, request_id, acting_listener_id=listener.id)
    except RequestNotPending:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pending request not found") from None
    return OkResult(status="declined")
