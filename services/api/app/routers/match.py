"""New-chat routing. v1 implements General (next-available). Personal is scaffolded."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import jobs, ratelimit
from app.db import get_db
from app.errors import ApiProblem
from app.jobs import tasks
from app.models.enums import RequestKind, RequestStatus
from app.models.listener import ListenerProfile
from app.models.request import ConversationRequest
from app.models.user import User
from app.routers.listeners import _request_out
from app.schemas import MatchRequest, MatchResult, RequestOut
from app.schemas.matching import MatchAsk
from app.security import current_user_id
from app.services import locks, mentor_face, mentor_names, open_question, paths, terms
from app.services.matching import (
    NoListenerAvailable,
    _pick_available_listener,
    blocked_listener_ids,
    match_general,
    own_listener_ids,
    sweep_stale_presence,
)

router = APIRouter(prefix="/match", tags=["match"])


@router.post("", response_model=MatchResult, dependencies=[Depends(mentor_names.fresh_names)])
def create_match(
    payload: MatchRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> MatchResult:
    # Each success consumes a human listener's capacity slot — a spam loop is a
    # denial of service against the actual people. Per-user, not per-IP.
    ratelimit.enforce(
        f"match:{user_id}", 10, 600, detail="Too many match attempts — please wait a moment."
    )
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown session")

    if payload.kind == RequestKind.personal:
        # Directed requests live on the listeners router: POST /listeners/{id}/request.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "personal requests go through POST /listeners/{listener_id}/request",
        )

    # No chat starts before the terms are accepted, while the gate is on (T3.9).
    terms.require(db, user_id)

    # Exam niches wait for a mentor's accept (DECISIONS §N.2): the instant match is for life in
    # general. The app asks through POST /match/ask; an older build gets a clear 409.
    if paths.accept_first(user.community_slug):
        raise ApiProblem(
            409,
            "accept_required",
            "A mentor on your road replies to your question first. Send it to a mentor.",
        )

    # One open question at a time (services/open_question.py): a Personal question still
    # waiting on a mentor holds "Next available" back — never for a member the crisis
    # scan flagged recently.
    open_question.enforce(db, user_id)

    try:
        convo = match_general(db, user, category=payload.issue_category)
    except NoListenerAvailable:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "No listener is available right now. Please try again in a moment.",
        )

    listener = db.get(ListenerProfile, convo.listener_id)
    return MatchResult(
        conversation_id=convo.id,
        stream_channel_id=convo.stream_channel_id,
        listener_persona_name=listener.persona_name,
        listener_persona_avatar=listener.persona_avatar,
        listener_companion_animal=mentor_face.face(listener)[0],
        listener_companion_colour=mentor_face.face(listener)[1],
    )


ASK_INTRO = "I'd like to talk to someone who has been on this road."


@router.post("/ask", response_model=RequestOut, dependencies=[Depends(mentor_names.fresh_names)])
def ask_best_mentor(
    payload: MatchAsk,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> RequestOut:
    """Next available mentor for an exam niche, by request: the best online mentor (same
    ranking as the instant match, the member's community preferred) gets the question in
    their inbox and the chat opens only when they accept. Nothing is reserved until then."""
    ratelimit.enforce(
        f"match-ask:{user_id}",
        10,
        3600,
        detail="You've sent several requests. Give mentors a little time to reply.",
    )
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown session")
    terms.require(db, user_id)
    locks.serialize_member(db, user_id)
    open_question.enforce(db, user_id)

    sweep_stale_presence(db)
    db.commit()
    blocked = blocked_listener_ids(db, user_id) | own_listener_ids(db, user_id)
    listener = _pick_available_listener(
        db, payload.issue_category, blocked, community=user.community_slug, certified_only=True
    )
    if listener is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "No listener is available right now. Please try again in a moment.",
        )
    req = ConversationRequest(
        kind=RequestKind.personal,
        status=RequestStatus.pending,
        requester_id=user_id,
        target_listener_id=listener.id,
        issue_category=payload.issue_category,
        intro_message=(payload.intro_message or "").strip() or ASK_INTRO,
    )
    db.add(req)
    db.flush()
    # Same transaction as the request row: the mentor is paged only if it commits.
    jobs.enqueue(db, tasks.push_request_created, best_effort=True, request_id=req.id)
    db.commit()
    db.refresh(req)
    return _request_out(req, db)
