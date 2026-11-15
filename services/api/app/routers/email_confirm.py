"""/me/email — add and confirm an email with a code (DECISIONS R.10).

The app asks for it from the member's second visit while `email_required_from_second_visit`
is on. Off until an email provider is set up; with the "log" placeholder, start is refused.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import ratelimit
from app.config import get_settings
from app.db import get_db
from app.errors import ApiProblem
from app.models.user import User
from app.schemas.common import OkResult
from app.schemas.email_confirm import EmailConfirmIn, EmailStartIn, EmailStatusOut
from app.security import current_user_id
from app.services import email_confirm, email_sender

router = APIRouter(prefix="/me/email", tags=["me"])


def _required() -> bool:
    s = get_settings()
    return bool(s.email_required_from_second_visit and s.email_provider != "log")


def _user(db: Session, user_id: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown session")
    return user


@router.get("", response_model=EmailStatusOut)
def email_status(
    user_id: str = Depends(current_user_id), db: Session = Depends(get_db)
) -> EmailStatusOut:
    user = _user(db, user_id)
    return EmailStatusOut(
        has_email=bool(user.email),
        verified=user.email_verified_at is not None,
        required=_required(),
    )


@router.post("/start", response_model=OkResult)
def email_start(
    payload: EmailStartIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OkResult:
    ratelimit.enforce(f"email-start:{user_id}", 5, 3600, detail="Too many codes — try later.")
    user = _user(db, user_id)
    try:
        email_confirm.start(db, user, str(payload.email).strip().lower())
    except email_sender.EmailNotConfigured:
        db.rollback()
        raise ApiProblem(503, "email_unavailable", "Email is not available yet.")
    db.commit()
    return OkResult(status="ok")


@router.post("/confirm", response_model=OkResult)
def email_confirm_code(
    payload: EmailConfirmIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OkResult:
    ratelimit.enforce(f"email-confirm:{user_id}", 20, 3600, detail="Too many tries — try later.")
    user = _user(db, user_id)
    try:
        email_confirm.confirm(db, user, payload.code)
    except email_confirm.Wrong:
        raise ApiProblem(400, "code_wrong", "That code did not work. Ask for a new one.")
    db.commit()
    return OkResult(status="ok")
