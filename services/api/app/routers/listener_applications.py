"""Become-a-listener applications (spec 2026-07-24).

Member-facing half of the funnel: apply + poll status. Approval/decline live in
the admin console router. `decline_reason` is deliberately absent from every
response here (T&S: no wound-poking)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ratelimit
from app.config import get_settings
from app.db import get_db
from app.errors import ApiProblem
from app.models.admin import AdminAuditLog
from app.models.enums import ApplicationStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.schemas import ConsoleSessionOut, ListenerApplicationIn, ListenerApplicationOut
from app.schemas.applications import StepBackIn, StepBackOut
from app.security import current_user_id, issue_listener_token
from app.services import categories, locks, moderation, stream
from app.services.links import mentor_console_link
from app.services.paths_data import COMMUNITIES

router = APIRouter(prefix="/listener-applications", tags=["listener-applications"])

REAPPLY_COOLDOWN = timedelta(days=30)


def _out(db: Session, a: ListenerApplication) -> ListenerApplicationOut:
    console_url = None
    step_back_requested_at = None
    if a.status == ApplicationStatus.approved and a.listener_id:
        # Mirror the admin console-link endpoint: a listener suspended after
        # approval must never be handed a fresh console token (T&S #9 —
        # suspension revokes access instantly).
        listener = db.get(ListenerProfile, a.listener_id)
        if listener is not None and listener.vetting_status == VettingStatus.approved:
            token = issue_listener_token(a.listener_id)
            console_url = mentor_console_link(token)
            if listener.step_back_requested_at is not None:
                step_back_requested_at = listener.step_back_requested_at.isoformat()
    reapply_after = None
    if a.status == ApplicationStatus.declined:
        reapply_after = (_declined_at(a) + REAPPLY_COOLDOWN).isoformat()
    return ListenerApplicationOut(
        id=a.id,
        status=a.status.value,
        mentor_interest=a.mentor_interest,
        created_at=a.created_at.isoformat(),
        console_url=console_url,
        reapply_after=reapply_after,
        step_back_requested_at=step_back_requested_at,
    )


def _declined_at(a: ListenerApplication) -> datetime:
    """The cooldown's anchor — the row's last write (see the note in `apply`)."""
    at = a.updated_at
    return at.replace(tzinfo=UTC) if at.tzinfo is None else at


def _latest(db: Session, user_id: str) -> ListenerApplication | None:
    return db.scalars(
        select(ListenerApplication)
        .where(ListenerApplication.user_id == user_id)
        .order_by(ListenerApplication.created_at.desc())
        .limit(1)
    ).first()


@router.post("", response_model=ListenerApplicationOut)
def apply(
    payload: ListenerApplicationIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ListenerApplicationOut:
    ratelimit.enforce(
        f"listener-apply:{user_id}",
        3,
        24 * 3600,
        detail="Too many attempts today — please try again tomorrow.",
    )
    if not payload.pledge_accepted:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "The listener pledge must be accepted."
        )
    unknown = [c for c in payload.communities if c not in COMMUNITIES]
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown community: {unknown[0]}"
        )

    # Serialize per-user apply: the check-then-insert below must not race itself
    # (two concurrent POSTs would create two pending rows). Row lock on the user,
    # same idiom as the matcher — and, like the matcher, a no-op on SQLite.
    locks.serialize_member(db, user_id)

    latest = _latest(db, user_id)
    if latest is not None:
        if latest.status in (ApplicationStatus.pending, ApplicationStatus.approved):
            raise HTTPException(status.HTTP_409_CONFLICT, "An application is already on file.")
        # Cooldown anchors to updated_at, so any future write to a declined row
        # restarts the 30-day clock (acceptable for now; a dedicated decided_at
        # column is the precise fix if that ever matters).
        if datetime.now(UTC) - _declined_at(latest) < REAPPLY_COOLDOWN:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Please wait a little before applying again — we'd love to hear from you later.",
            )

    row = ListenerApplication(
        user_id=user_id,
        motivation=payload.motivation,
        communities=payload.communities,
        availability=payload.availability,
        available_times=(
            categories.ordered_times(payload.available_times)
            if payload.available_times is not None
            else None
        ),
        email=payload.email,
        mentor_interest=payload.mentor_interest,
        pledge_accepted_at=datetime.now(UTC),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(db, row)


@router.get("/me", response_model=ListenerApplicationOut | None)
def my_application(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ListenerApplicationOut | None:
    latest = _latest(db, user_id)
    return None if latest is None else _out(db, latest)


@router.post("/me/console-session", response_model=ConsoleSessionOut)
def console_session(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ConsoleSessionOut:
    """Hand an approved member their listener credential for the NATIVE console
    (spec 2026-09-05 §3). Same live double-check as `console_url`: a listener
    suspended after approval is refused (T&S #9), and the console re-checks
    vetting on every request after this, so revocation still bites instantly."""
    ratelimit.enforce(
        f"console-session:{user_id}",
        10,
        3600,
        detail="Too many console sign-ins — please try again in an hour.",
    )
    latest = _latest(db, user_id)
    if latest is None or latest.status != ApplicationStatus.approved or not latest.listener_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not_approved")
    listener = db.get(ListenerProfile, latest.listener_id)
    if listener is None or listener.vetting_status != VettingStatus.approved:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not_approved")
    # Idempotent and best-effort: heals a mentor whose Stream user never landed at
    # approval time, so their first channel can be created.
    stream.ensure_user(listener.id, listener.persona_name, listener.persona_avatar)
    ttl = timedelta(days=get_settings().listener_jwt_ttl_days)
    return ConsoleSessionOut(
        listener_token=issue_listener_token(listener.id),
        listener_id=listener.id,
        persona_name=listener.persona_name,
        persona_avatar=listener.persona_avatar,
        stream_token=stream.user_token(listener.id),
        expires_at=(datetime.now(UTC) + ttl).isoformat(),
    )


STEP_BACK_AUDIT_ACTOR_ID = "system"
STEP_BACK_AUDIT_ACTOR_NAME = "Mentor step-back"


@router.post(
    "/me/step-back",
    response_model=StepBackOut,
    responses={409: {"description": "`not_live_mentor` — no approved, live mentor side"}},
)
def step_back(
    payload: StepBackIn | None = None,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> StepBackOut:
    """A live mentor asks the team to step their mentor side back (board A32 / capture
    409): Start fresh refuses a live mentor (DECISIONS §L.11 ii), so this is their
    self-serve way to get there. Records the request on the mentor's profile, where the
    admin Listeners panel lists it first; the team then suspends with the existing,
    audited tool, after which erasure proceeds. Nothing is suspended here — the mentor
    may be mid-conversation with members, and the team decides how to hand those over.

    Idempotent: a second ask answers the first one's time and keeps its reason. Refused
    with 409 `not_live_mentor` when there is no approved application whose mentor
    profile is still approved (a suspended side does not block Start fresh anyway)."""
    ratelimit.enforce(
        f"step-back:{user_id}", 5, 3600, detail="Too many tries — please wait a little."
    )
    latest = _latest(db, user_id)
    listener = (
        db.get(ListenerProfile, latest.listener_id)
        if latest is not None and latest.status == ApplicationStatus.approved and latest.listener_id
        else None
    )
    if listener is None or listener.vetting_status != VettingStatus.approved:
        raise ApiProblem(
            status.HTTP_409_CONFLICT,
            "not_live_mentor",
            "There is no active mentor side on this account.",
        )
    if listener.step_back_requested_at is None:
        reason = (payload.reason or "").strip() if payload is not None else ""
        listener.step_back_requested_at = datetime.now(UTC)
        # Contact details typed into the box are masked, as in chat and feedback.
        listener.step_back_reason = moderation.redact(reason).text if reason else None
        # THAT a mentor asked, keyed to the mentor profile (the admin's subject) — never
        # the member id, and never the reason (the panel shows it; the trail does not).
        db.add(
            AdminAuditLog(
                admin_id=STEP_BACK_AUDIT_ACTOR_ID,
                admin_name=STEP_BACK_AUDIT_ACTOR_NAME,
                action="listener.step_back_requested",
                subject_type="listener",
                subject_id=listener.id,
                meta={},
            )
        )
        db.commit()
    return StepBackOut(requested_at=listener.step_back_requested_at.isoformat())
