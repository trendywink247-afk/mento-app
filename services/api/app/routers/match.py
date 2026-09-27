"""New-chat routing. v1 implements General (next-available). Personal is scaffolded."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import get_db
from app.models.enums import RequestKind
from app.models.listener import ListenerProfile
from app.models.user import User
from app.schemas import MatchRequest, MatchResult
from app.security import current_user_id
from app.services import mentor_face, mentor_names, open_question, terms
from app.services.matching import NoListenerAvailable, match_general

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
