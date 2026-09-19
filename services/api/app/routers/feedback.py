"""Product feedback (board A11) — a member or a mentor tells the team what happened.

Stored WITHOUT identity and without conversation content: see models/feedback.py. The
words are passed through the same PII redactor as chat messages before they are saved
(a phone number typed into the box is not something the team needs to keep), and
through the crisis scan first — someone may type the heaviest thing they have into the
nearest text box, and the answer to that is the helplines, not "thanks". Those words
are never kept as feedback.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import get_db
from app.models.enums import VettingStatus
from app.models.feedback import ProductFeedback
from app.models.listener import ListenerProfile
from app.models.user import User
from app.schemas import FeedbackIn, FeedbackReceived
from app.security import current_member_or_listener
from app.services import crisis, moderation, safety

logger = logging.getLogger("mento.feedback")
router = APIRouter(prefix="/feedback", tags=["feedback"])


def feedback_author(
    who: tuple[str, str] = Depends(current_member_or_listener),
    db: Session = Depends(get_db),
) -> tuple[str, str]:
    """The token must belong to a real account: an unknown member is 401 (re-onboard,
    like /me); a mentor who is not approved is 403 (like the rest of the console)."""
    role, subject = who
    if role == "member":
        if db.get(User, subject) is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown session")
    else:
        listener = db.get(ListenerProfile, subject)
        if listener is None or listener.vetting_status != VettingStatus.approved:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "listener access revoked")
    return role, subject


@router.post("", response_model=FeedbackReceived)
def send_feedback(
    payload: FeedbackIn,
    author: tuple[str, str] = Depends(feedback_author),
    db: Session = Depends(get_db),
) -> FeedbackReceived:
    role, subject = author
    # The ONLY place the author's id is used: a Redis key that expires with its window.
    allowed = ratelimit.allow(f"feedback:{role}:{subject}", 5, 3600)

    found = crisis.scan(payload.text)  # pure — no database, cannot fail
    if found.triggered:
        # Not product feedback: a person in a hard moment. The helplines go back
        # whatever the rate limit says, and the WORDS ARE NOT KEPT (T&S #6 — a crisis
        # is stored as a signal, never as text). Within the limit, the signal goes to
        # human review like every other entry point.
        if allowed:
            try:
                safety.scan_and_flag(db, text=payload.text, user_id=subject)
            except Exception as exc:  # noqa: BLE001 — the helplines do not depend on it
                db.rollback()
                logger.error("crisis flag NOT persisted from feedback (%s)", type(exc).__name__)
        return FeedbackReceived(
            status="support",
            crisis={
                "support": safety.SUPPORT_COPY,
                "signal": found.signal.value,
                "helplines": found.helplines,
            },
        )

    if not allowed:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Thank you — we have your notes. You can send more in a little while.",
        )

    db.add(
        ProductFeedback(
            role=role,
            category=payload.category,
            text=moderation.redact(payload.text).text,
            screen=payload.screen,
            app_version=payload.app_version,
        )
    )
    db.commit()
    return FeedbackReceived(status="received")
