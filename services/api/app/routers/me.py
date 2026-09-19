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
from app.schemas import AllowanceOut, CompanionUpdateIn, MeOut, OkResult
from app.security import current_user_id
from app.services import allowance, erasure

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
    if "companion_animal" in fields:
        user.companion_animal = payload.companion_animal
    if "companion_colour" in fields:
        user.companion_colour = payload.companion_colour
    db.commit()
    db.refresh(user)
    return _out(user)


@router.delete(
    "",
    response_model=OkResult,
    responses={
        409: {"description": "`mentor_active` — also a live mentor; nothing was touched"},
        503: {"description": "`erase_incomplete` — chats ended, the rest not yet; retry"},
    },
)
def erase_me(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OkResult:
    """Start fresh, for real (audit F24, DECISIONS §L.11): erase this member and
    everything keyed to them — see `services/erasure.py` for exactly what is deleted,
    what is kept detached (safety flags, reports) and why.

    Idempotent: once erased, the same session gets 200 again and nothing happens.
    Fail-safe: when Stream cannot confirm a deletion the answer is 503 `erase_incomplete`
    — chats are ended, nothing else is claimed, the member row stays so the app retries
    with the same session. Refused with 409 `mentor_active` while the member is also a
    live mentor (nothing touched)."""
    ratelimit.enforce(
        f"erase:{user_id}", 10, 3600, detail="Too many tries — please wait a little and try again."
    )
    try:
        erasure.erase_member(db, user_id)
    except erasure.MentorActive as exc:
        raise ApiProblem(
            status.HTTP_409_CONFLICT,
            "mentor_active",
            "You are also a mentor here. Erasing everything would leave the people you "
            "talk with mid-conversation, so it cannot be done from here yet.",
        ) from exc
    except erasure.EraseIncomplete as exc:
        raise ApiProblem(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "erase_incomplete",
            "Your chats have ended, but the rest is not deleted yet. Please try again "
            "in a moment.",
        ) from exc
    return OkResult(status="erased")
