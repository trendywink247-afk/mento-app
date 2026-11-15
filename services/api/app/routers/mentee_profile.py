"""GET/PUT/DELETE /me/mentee-profile — the mentorship intake form (DECISIONS R.6, R.14).

Every field is optional; the member can edit or clear it any time; erasure deletes it.
The note is crisis-scanned on save, like request words (a mentor reads it with the
request): a signal-only flag, the helpline card back, and the profile still saved.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import get_db
from app.models.mentee_profile import MenteeProfile
from app.models.user import User
from app.schemas.listeners import SupportOut
from app.schemas.mentee_profile import MenteeProfileIn, MenteeProfileOut
from app.security import current_user_id
from app.services import mentee_profiles, safety

router = APIRouter(prefix="/me", tags=["me"])


def _out(row: MenteeProfile | None) -> MenteeProfileOut:
    a = mentee_profiles.answers(row)
    return MenteeProfileOut(
        **a.model_dump(),
        updated_at=row.updated_at.isoformat() if row is not None and row.updated_at else None,
    )


@router.get("/mentee-profile", response_model=MenteeProfileOut)
def get_mentee_profile(
    user_id: str = Depends(current_user_id), db: Session = Depends(get_db)
) -> MenteeProfileOut:
    return _out(mentee_profiles.load(db, user_id))


@router.put("/mentee-profile", response_model=MenteeProfileOut)
def put_mentee_profile(
    payload: MenteeProfileIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> MenteeProfileOut:
    ratelimit.enforce(
        f"mentee-profile:{user_id}", 30, 3600, detail="Too many changes — please slow down."
    )
    if db.get(User, user_id) is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown session")
    # Scan only words that changed: re-saving the same note must not raise a new flag.
    before = mentee_profiles.answers(mentee_profiles.load(db, user_id))
    changed = [
        w
        for w, old in (
            (payload.note, before.note),
            (payload.optional_subject, before.optional_subject),
        )
        if w and w.strip() and w != old
    ]
    crisis_result = safety.scan_request_intro(db, text=" ".join(changed) or None, user_id=user_id)
    row = mentee_profiles.save(db, user_id, payload)
    db.commit()
    db.refresh(row)
    out = _out(row)
    if crisis_result is not None:
        out.support = SupportOut(message=safety.SUPPORT_COPY, helplines=crisis_result.helplines)
    return out


@router.delete("/mentee-profile", status_code=status.HTTP_204_NO_CONTENT)
def delete_mentee_profile(
    user_id: str = Depends(current_user_id), db: Session = Depends(get_db)
) -> None:
    row = mentee_profiles.load(db, user_id)
    if row is not None:
        db.delete(row)
        db.commit()
