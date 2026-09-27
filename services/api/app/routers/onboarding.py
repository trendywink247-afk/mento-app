"""Anonymous onboarding + server-side age gate (Trust & Safety #3)."""

from __future__ import annotations

import hashlib
import logging
from datetime import UTC, date, datetime

import redis
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app import ratelimit
from app.config import get_settings
from app.db import get_db
from app.errors import ApiProblem
from app.models.user import User
from app.schemas import OnboardingResult, OnboardingStart, PersonaOut
from app.security import issue_session_token
from app.services import member_status, sessions, stream, terms
from app.services.persona import generate_persona

logger = logging.getLogger("mento.onboarding")
router = APIRouter(prefix="/onboarding", tags=["onboarding"])


def _install_hash(install_id: str | None) -> str | None:
    """Only a SHA-256 of the app's random per-install id is ever stored."""
    if not install_id:
        return None
    return hashlib.sha256(install_id.encode()).hexdigest()


# Age-gate friction (T3.8): after an under-age refusal the same install is refused for a
# day whatever date it sends next, and an address is refused once it has collected
# AGE_REFUSALS_PER_IP refusals in that day (one refusal must not lock out the adults
# sharing a hostel or carrier address). Friction, not proof — the server-side DOB rule
# stays the gate. Rides the rate-limit switch and Redis; a Redis error skips it.
AGE_COOLDOWN_SECONDS = 24 * 3600
AGE_REFUSALS_PER_IP = 3


def _age_keys(request: Request, install_hash: str | None) -> tuple[str, str | None]:
    ip_key = f"agegate:ip:{ratelimit.client_ip(request)}"
    return ip_key, f"agegate:install:{install_hash}" if install_hash else None


def _age_cooling_down(request: Request, install_hash: str | None) -> bool:
    if not ratelimit.limits_enabled():
        return False
    ip_key, install_key = _age_keys(request, install_hash)
    try:
        r = ratelimit._redis()
        if install_key and r.exists(install_key):
            return True
        return int(r.get(ip_key) or 0) >= AGE_REFUSALS_PER_IP
    except redis.RedisError:
        logger.warning("age-gate cooldown unavailable — skipped")
        return False


def _remember_age_refusal(request: Request, install_hash: str | None) -> None:
    if not ratelimit.limits_enabled():
        return
    ip_key, install_key = _age_keys(request, install_hash)
    try:
        pipe = ratelimit._redis().pipeline()
        pipe.incr(ip_key)
        pipe.expire(ip_key, AGE_COOLDOWN_SECONDS, nx=True)
        if install_key:
            pipe.set(install_key, "1", ex=AGE_COOLDOWN_SECONDS)
        pipe.execute()
    except redis.RedisError:
        logger.warning("age-gate cooldown unavailable — refusal not remembered")


def _age_on(dob: date, today: date) -> int:
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


@router.post(
    "/start",
    response_model=OnboardingResult,
    status_code=status.HTTP_201_CREATED,
    dependencies=[
        # Unauthenticated + each call inserts a user and hits Stream: the app's
        # cheapest flooding target. Generous for humans, ruinous for loops. Fails
        # CLOSED (503) when Redis is down — a blind limiter here means unbounded
        # accounts (T3.11); people already talking are unaffected.
        Depends(
            ratelimit.by_ip(
                "onboarding",
                10,
                3600,
                detail="Too many new sessions — please wait a bit.",
                fail_closed=True,
            )
        )
    ],
)
def start(
    payload: OnboardingStart, request: Request, db: Session = Depends(get_db)
) -> OnboardingResult:
    settings = get_settings()
    install_hash = _install_hash(payload.install_id)
    if _age_cooling_down(request, install_hash):
        raise ApiProblem(
            status.HTTP_403_FORBIDDEN,
            "age_gate_cooldown",
            f"Mento is available to people {settings.min_age} and older.",
        )
    # UTC, not server-local: a user a day either side of the min-age boundary must
    # not be admitted/denied by the server's timezone.
    today = datetime.now(UTC).date()

    if payload.dob > today:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "date of birth is in the future")

    age = _age_on(payload.dob, today)
    if age < settings.min_age:
        # Helped out, not retained. Block under-min-age (PRD §10 recommendation).
        _remember_age_refusal(request, install_hash)
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
        companion_name=payload.companion_name,
        install_hash=install_hash,
    )
    if payload.terms_accepted:
        terms.accept(user)
    db.add(user)
    db.commit()
    db.refresh(user)
    # refresh() opened a fresh transaction; end it BEFORE the outbound Stream
    # calls so no DB transaction/connection spans slow network I/O (A1: the same
    # phasing discipline as services/matching.py).
    db.commit()

    try:
        stream.upsert_user(user.id, user.persona_name, user.persona_avatar)
    except Exception as exc:  # noqa: BLE001 — any Stream fault takes the same exit
        # Without a Stream user the member can never be put in a channel, so this
        # account is useless — and every retry would mint another one. Undo it and
        # say so honestly; the app's retry starts clean.
        logger.warning("onboarding: Stream upsert failed (%s) — rolled back", type(exc).__name__)
        db.delete(user)
        db.commit()
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "We couldn't set things up just now. Please try again in a moment.",
        ) from None

    # A new account from a blocked member's install is flagged for review (T3.7) —
    # after the Stream upsert, so a rolled-back signup leaves no flag behind.
    if member_status.flag_rejoin(db, user):
        db.commit()

    persona_out = PersonaOut(
        id=user.id, persona_name=user.persona_name, persona_avatar=user.persona_avatar
    )
    if payload.refresh:
        pair = sessions.start(db, user.id, device_id=payload.device_id)
        db.commit()
        return OnboardingResult(
            session_token=pair.access_token,
            stream_token=stream.user_token(user.id),
            user=persona_out,
            refresh_token=pair.refresh_token,
            expires_in=pair.expires_in,
        )
    return OnboardingResult(
        session_token=issue_session_token(user.id),
        stream_token=stream.user_token(user.id),
        user=persona_out,
    )
