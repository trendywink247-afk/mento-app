"""The member's own account — what the app may read back and change about itself.

Persona + companion only. Never DOB, age or email (they are gate / recovery inputs,
not profile), and nothing here is visible to anyone but the caller.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import get_db
from app.errors import ApiProblem
from app.models.user import User
from app.schemas import AllowanceOut, CompanionUpdateIn, MeOut
from app.security import current_user_id
from app.services import allowance, companions

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
        companion_name=user.companion_name,
    )


@router.get("", response_model=MeOut)
def me(user: User = Depends(current_user)) -> MeOut:
    return _out(user)


@router.get("/allowance", response_model=AllowanceOut)
def my_allowance(user: User = Depends(current_user), db: Session = Depends(get_db)) -> AllowanceOut:
    """The daily half of the message allowance (DECISIONS §L.2), for screens that have
    no conversation yet — the first-question builder's "1 of your 10" meter.
    `in_a_row` is always 0 here; ask `GET /conversations/{id}/allowance` inside a chat."""
    return allowance.to_out(allowance.state_for(db, user.id, None))


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
    # The name is checked before anything changes, so a refused name saves nothing.
    # It is the member's own and is returned here and by GET /me — nowhere else.
    if "companion_name" in fields and payload.companion_name is not None:
        try:
            name: str | None = companions.clean_name(payload.companion_name)
        except companions.CompanionNameInvalid:
            raise ApiProblem(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                companions.NAME_INVALID_CODE,
                companions.NAME_INVALID_DETAIL,
            ) from None
    else:
        name = None
    if "companion_name" in fields:
        user.companion_name = name
    if "companion_animal" in fields:
        user.companion_animal = payload.companion_animal
    if "companion_colour" in fields:
        user.companion_colour = payload.companion_colour
    db.commit()
    db.refresh(user)
    return _out(user)
