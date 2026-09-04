"""Anonymous onboarding + server-side age gate (Trust & Safety #3)."""

from __future__ import annotations

from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import ratelimit
from app.config import get_settings
from app.db import get_db
from app.models.user import User
from app.schemas import OnboardingResult, OnboardingStart, PersonaOut
from app.security import issue_session_token
from app.services import stream
from app.services.persona import generate_persona

router = APIRouter(prefix="/onboarding", tags=["onboarding"])


def _age_on(dob: date, today: date) -> int:
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


@router.post(
    "/start",
    response_model=OnboardingResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[
        # Unauthenticated + each call inserts a user and hits Stream: the app's
        # cheapest flooding target. Generous for humans, ruinous for loops.
        Depends(
            ratelimit.by_ip(
                "onboarding", 10, 3600, detail="Too many new sessions — please wait a bit."
            )
        )
    ],
)
def start(payload: OnboardingStart, db: Session = Depends(get_db)) -> OnboardingResult:
    settings = get_settings()
    # UTC, not server-local: a user a day either side of the min-age boundary must
    # not be admitted/denied by the server's timezone.
    today = datetime.now(UTC).date()

    if payload.dob > today:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "date of birth is in the future")

    age = _age_on(payload.dob, today)
    if age < settings.min_age:
        # Helped out, not retained. Block under-min-age (PRD §10 recommendation).
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"Mento is available to people {settings.min_age} and older.",
        )

    persona = generate_persona()
    user = User(
        persona_name=persona.name,
        persona_avatar=persona.avatar,
        dob=payload.dob,
        age_at_signup=age,
        email=payload.email,
        companion_animal=payload.companion_animal,
        companion_colour=payload.companion_colour,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    # refresh() opened a fresh transaction; end it BEFORE the outbound Stream
    # calls so no DB transaction/connection spans slow network I/O (A1: the same
    # phasing discipline as services/matching.py).
    db.commit()

    stream.upsert_user(user.id, user.persona_name, user.persona_avatar)

    return OnboardingResult(
        session_token=issue_session_token(user.id),
        stream_token=stream.user_token(user.id),
        user=PersonaOut(
            id=user.id, persona_name=user.persona_name, persona_avatar=user.persona_avatar
        ),
    )
