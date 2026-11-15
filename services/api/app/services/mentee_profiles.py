"""The mentee profile (DECISIONS R.6, R.14): stored answers and the brief a mentor may see."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.models.mentee_profile import MenteeProfile
from app.schemas.mentee_profile import MARK_FIELDS, MenteeBriefOut, MenteeProfileIn
from app.services import tiers


def load(db: Session, user_id: str) -> MenteeProfile | None:
    return db.get(MenteeProfile, user_id)


def answers(row: MenteeProfile | None) -> MenteeProfileIn:
    if row is None:
        return MenteeProfileIn()
    data = dict(row.data or {})
    data["marks_visibility"] = row.marks_visibility
    return MenteeProfileIn.model_validate(data)


def save(db: Session, user_id: str, payload: MenteeProfileIn) -> MenteeProfile:
    row = db.get(MenteeProfile, user_id)
    data = payload.model_dump(mode="json", exclude={"marks_visibility"})
    if row is None:
        row = MenteeProfile(user_id=user_id, data=data, marks_visibility=payload.marks_visibility)
        db.add(row)
    else:
        row.data = data
        row.marks_visibility = payload.marks_visibility
        row.updated_at = datetime.now(UTC)
    return row


def marks_visible(visibility: str, tier: str) -> bool:
    if visibility == "everyone":
        return True
    if visibility == "mentors":
        return tier in (tiers.MENTOR, tiers.VERIFIED)
    return False


def brief(row: MenteeProfile | None, viewer_tier: str) -> MenteeBriefOut | None:
    """The brief for a mentor of `viewer_tier`; None when the member shared nothing."""
    if row is None:
        return None
    a = answers(row)
    shown = marks_visible(a.marks_visibility, viewer_tier)
    attempts = []
    for att in a.attempts:
        if not shown:
            att = att.model_copy(update={f: None for f in MARK_FIELDS})
        attempts.append(att)
    return MenteeBriefOut(
        exam=a.exam,
        current_stage=a.current_stage,
        attempts_count=a.attempts_count,
        furthest_stage=a.furthest_stage,
        optional_subject=a.optional_subject,
        prep_mode=a.prep_mode,
        language=a.language,
        help_with=list(a.help_with),
        note=a.note,
        attempts=attempts,
        marks_shown=shown
        and any(getattr(x, f) is not None for x in a.attempts for f in MARK_FIELDS),
    )
