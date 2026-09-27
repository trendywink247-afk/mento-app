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
from app.schemas import AllowanceOut, CompanionUpdateIn, MeOut, OkResult, RecoveryOut
from app.security import current_user_id, current_user_id_any_standing
from app.services import allowance, companions, erasure, member_status, recovery, terms

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
    now = member_status.standing(user.status, user.banned_until)
    return MeOut(
        status=now.status.value,
        status_until=now.until.isoformat() if now.until else None,
        terms_accepted=terms.accepted(user),
        terms_required=terms.required(user),
        has_recovery=user.recovery_hash is not None,
        id=user.id,
        persona_name=user.persona_name,
        persona_avatar=user.persona_avatar,
        companion_animal=user.companion_animal,
        companion_colour=user.companion_colour,
        has_dob=user.dob is not None,
        member_setup_complete=user.dob is not None and user.companion_animal is not None,
        companion_name=user.companion_name,
    )


@router.get("", response_model=MeOut)
def me(
    user_id: str = Depends(current_user_id_any_standing),
    db: Session = Depends(get_db),
) -> MeOut:
    """Reachable while suspended or banned (T3.7) — the one read that lets the app say
    why the rest answers 403, and until when."""
    return _out(current_user(user_id, db))


@router.post("/terms", response_model=MeOut)
def accept_terms(user: User = Depends(current_user), db: Session = Depends(get_db)) -> MeOut:
    """Accept the current terms (T3.9) — for members who joined before the app asked,
    or after the version changed. Idempotent: re-accepting moves the time forward."""
    terms.accept(user)
    db.commit()
    db.refresh(user)
    return _out(user)


@router.post("/recovery", response_model=RecoveryOut)
def make_recovery_code(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> RecoveryOut:
    """A recovery code (T3.5), shown ONCE — the app says "Mento will never ask you for
    this". A new one replaces the old. Rate-limited and fail-closed (a 503 beats an
    unthrottled secret mint)."""
    ratelimit.enforce(
        f"recovery-issue:{user.id}",
        5,
        3600,
        detail="Too many new codes — please try again in an hour.",
        fail_closed=True,
    )
    phrase = recovery.issue(user)
    db.commit()
    return RecoveryOut(phrase=phrase)


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
