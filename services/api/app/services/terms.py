"""The terms gate (T3.9). A member accepts the CURRENT `terms_version`; while
`terms_gate_enforced` is on, no chat starts without it (General match and Personal
request both call `require`), so no first message can be sent."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import status
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import ApiProblem
from app.models.user import User


def accepted(user: User) -> bool:
    return user.terms_accepted_at is not None and user.terms_version == get_settings().terms_version


def required(user: User) -> bool:
    """True when this member must accept before starting a chat."""
    return get_settings().terms_gate_enforced and not accepted(user)


def accept(user: User) -> None:
    """Record acceptance of the current version; the caller commits."""
    user.terms_accepted_at = datetime.now(UTC)
    user.terms_version = get_settings().terms_version


def require(db: Session, user_id: str) -> None:
    user = db.get(User, user_id)
    if user is not None and required(user):
        raise ApiProblem(
            status.HTTP_409_CONFLICT,
            "terms_required",
            "Please read and accept Mento's terms before starting a conversation.",
        )
