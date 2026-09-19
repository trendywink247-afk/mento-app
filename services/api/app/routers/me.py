"""The member's own account — what the app may read back and change about itself.

Persona + companion only. Never DOB, age or email (they are gate / recovery inputs,
not profile), and nothing here is visible to anyone but the caller.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import get_db
from app.models.user import User
from app.schemas import CompanionUpdateIn, MeOut
from app.security import current_user_id

router = APIRouter(prefix="/me", tags=["me"])


def current_user(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> User:
    """A valid token for a user row that no longer exists is an unknown session — 401,
    so the app re-onboards (same answer POST /match gives)."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown session")
    return user


def _out(user: User) -> MeOut:
    return MeOut(
        id=user.id,
        persona_name=user.persona_name,
        persona_avatar=user.persona_avatar,
        companion_animal=user.companion_animal,
        companion_colour=user.companion_colour,
    )


@router.get("", response_model=MeOut)
def me(user: User = Depends(current_user)) -> MeOut:
    return _out(user)


@router.put("/companion", response_model=MeOut)
def update_companion(
    payload: CompanionUpdateIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> MeOut:
    """Set the companion on an EXISTING account — a member who came in through the
    mentor door picks theirs later, and it used to live on the device only, so the
    mentor's brief showed nothing. PATCH semantics on a PUT (like
    PUT /listener/me/profile): a field left out is unchanged, `null` clears it.
    Values are validated against services/companions — a 422 names the allowed set."""
    ratelimit.enforce(
        f"companion:{user.id}", 30, 3600, detail="Too many changes — please try again in a bit."
    )
    fields = payload.model_fields_set
    if "companion_animal" in fields:
        user.companion_animal = payload.companion_animal
    if "companion_colour" in fields:
        user.companion_colour = payload.companion_colour
    db.commit()
    db.refresh(user)
    return _out(user)
