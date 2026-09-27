"""Admin dashboard API (spec 2026-07-13). Web-only console; token-link auth with
per-request revocation; every mutation + conversation view is audit-logged.
Anonymity holds: personas only, message bodies never stored."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.errors import ApiProblem
from app.models.admin import AdminAccount, AdminAuditLog
from app.models.conversation import Conversation
from app.models.enums import (
    AdminRole,
    AdminStatus,
    ApplicationStatus,
    ConversationStatus,
    ListenerStatus,
    ModerationLevel,
    ReporterKind,
    SafetySignal,
    VettingStatus,
)
from app.models.feedback import ProductFeedback
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.moderation import ModerationEvent
from app.models.safety import SafetyFlag
from app.models.user import User
from app.schemas import (
    AdminAccountItem,
    AdminAllowanceDay,
    AdminAllowanceOut,
    AdminAllowanceRule,
    AdminApplicationDeclineIn,
    AdminApplicationItem,
    AdminAuditItem,
    AdminConsoleLinkOut,
    AdminContributionItem,
    AdminCreatedOut,
    AdminCreateIn,
    AdminFeedbackItem,
    AdminFeedbackOut,
    AdminFlagItem,
    AdminFlagReviewIn,
    AdminHealthOut,
    AdminListenerCreateIn,
    AdminListenerItem,
    AdminListenerPatchIn,
    AdminMeOut,
    AdminMessageItem,
    AdminOverviewOut,
    AdminReconcileOut,
    AttentionItem,
    ModerationItem,
    ModerationResolveIn,
    OkResult,
)
from app.security import current_admin_id, issue_admin_token, issue_listener_token
from app.services import (
    allowance,
    audit,
    conversations,
    in_touch,
    member_status,
    mentor_face,
    stream,
)
from app.services.categories import availability_note, ordered_times
from app.services.links import admin_link, mentor_console_link
from app.services.matching import reconcile_listener_capacity
from app.services.persona import generate_persona

router = APIRouter(prefix="/admin", tags=["admin"])


def current_admin(
    admin_id: str = Depends(current_admin_id),
    db: Session = Depends(get_db),
) -> AdminAccount:
    """Load the admin; status is checked every request so revoke is instant."""
    admin = db.get(AdminAccount, admin_id)
    if admin is None or admin.status != AdminStatus.active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin access revoked")
    return admin


def require_owner(admin: AdminAccount = Depends(current_admin)) -> AdminAccount:
    if admin.role != AdminRole.owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "owner only")
    return admin


@router.get("/me", response_model=AdminMeOut)
def me(admin: AdminAccount = Depends(current_admin)) -> AdminMeOut:
    return AdminMeOut(id=admin.id, name=admin.name, role=admin.role.value)


# --- Overview (cockpit) -------------------------------------------------------


@router.get("/overview", response_model=AdminOverviewOut)
def overview(
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminOverviewOut:
    start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)

    def count(stmt) -> int:
        return db.execute(stmt).scalar_one()

    members_today = count(select(func.count()).select_from(User).where(User.created_at >= start))
    matches_today = count(
        select(func.count()).select_from(Conversation).where(Conversation.created_at >= start)
    )
    active = count(
        select(func.count())
        .select_from(Conversation)
        .where(Conversation.status == ConversationStatus.active)
    )
    online = count(
        select(func.count())
        .select_from(ListenerProfile)
        .where(
            ListenerProfile.status == ListenerStatus.online,
            ListenerProfile.vetting_status == VettingStatus.approved,
        )
    )
    flags = count(
        select(func.count())
        .select_from(SafetyFlag)
        .where(SafetyFlag.reviewed.is_(False), SafetyFlag.signal != SafetySignal.none)
    )
    reports = count(
        select(func.count()).select_from(ModerationEvent).where(ModerationEvent.reviewed.is_(False))
    )

    attention: list[AttentionItem] = []
    if flags:
        attention.append(
            AttentionItem(kind="safety", text=f"{flags} crisis flag(s) to review", href="safety")
        )
    if reports:
        attention.append(
            AttentionItem(
                kind="moderation", text=f"{reports} report(s) to review", href="moderation"
            )
        )
    return AdminOverviewOut(
        members_today=members_today,
        matches_today=matches_today,
        active_conversations=active,
        listeners_online=online,
        flags_unreviewed=flags,
        reports_unreviewed=reports,
        attention=attention,
    )


# --- Safety review ------------------------------------------------------------


@router.get("/safety/flags", response_model=list[AdminFlagItem])
def safety_flags(
    reviewed: bool = False,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[AdminFlagItem]:
    rows = (
        db.execute(
            select(SafetyFlag)
            .where(SafetyFlag.reviewed.is_(reviewed), SafetyFlag.signal != SafetySignal.none)
            .order_by(SafetyFlag.created_at.desc())
            .limit(200)
        )
        .scalars()
        .all()
    )
    # Three batched lookups for the whole page — this was three queries PER flag.
    convo_ids = {f.conversation_id for f in rows if f.conversation_id}
    convos = {
        c.id: c
        for c in db.scalars(select(Conversation).where(Conversation.id.in_(convo_ids))).all()
    }
    member_names = dict(
        db.execute(
            select(User.id, User.persona_name).where(
                User.id.in_({c.user_id for c in convos.values()})
            )
        ).all()
    )
    listener_names = dict(
        db.execute(
            select(ListenerProfile.id, ListenerProfile.persona_name).where(
                ListenerProfile.id.in_({c.listener_id for c in convos.values()})
            )
        ).all()
    )

    def _item(f: SafetyFlag) -> AdminFlagItem:
        convo = convos.get(f.conversation_id) if f.conversation_id else None
        return AdminFlagItem(
            id=f.id,
            signal=f.signal.value,
            conversation_id=f.conversation_id,
            member_persona=member_names.get(convo.user_id) if convo else None,
            listener_persona=listener_names.get(convo.listener_id) if convo else None,
            reviewed=f.reviewed,
            created_at=f.created_at.isoformat(),
        )

    return [_item(f) for f in rows]


@router.post("/safety/flags/{flag_id}/review", response_model=OkResult)
def review_flag(
    flag_id: str,
    payload: AdminFlagReviewIn,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> OkResult:
    flag = db.get(SafetyFlag, flag_id)
    if flag is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "flag not found")
    flag.reviewed = True
    flag.reviewed_by = admin.name
    flag.action = payload.action
    audit.record(
        db,
        admin,
        "flag.reviewed",
        subject_type="safety_flag",
        subject_id=flag_id,
        meta={"action": payload.action},
    )
    db.commit()
    return OkResult(status="reviewed")


def _open_case(db: Session, convo_id: str) -> str | None:
    """Why this conversation may be read: an unreviewed safety flag or an unresolved
    report on IT. None = no open case, no read."""
    flag = db.scalars(
        select(SafetyFlag.id)
        .where(SafetyFlag.conversation_id == convo_id, SafetyFlag.reviewed.is_(False))
        .limit(1)
    ).first()
    if flag is not None:
        return "safety_flag"
    report = db.scalars(
        select(ModerationEvent.id)
        .where(
            ModerationEvent.conversation_id == convo_id,
            ModerationEvent.reviewed.is_(False),
        )
        .limit(1)
    ).first()
    return "report" if report is not None else None


READ_REASON_MIN = 8


@router.get(
    "/conversations/{convo_id}/messages",
    response_model=list[AdminMessageItem],
    responses={403: {"description": "`no_open_case` — no open flag or report on it"}},
)
def conversation_messages(
    convo_id: str,
    reason: str = Query(min_length=READ_REASON_MIN, max_length=300),
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[AdminMessageItem]:
    """Read-only live view for crisis review. Fetched from Stream, never stored.

    Scoped (T3.12): only while the conversation has an open case — an unreviewed
    safety flag or an unresolved report on it — and only with a stated reason. The
    view is audit-logged with that reason and the kind of case (reads are
    accountable); a refused read fetches nothing."""
    reason = reason.strip()
    if len(reason) < READ_REASON_MIN:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "a reason is required")
    convo = db.get(Conversation, convo_id)
    if convo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    case = _open_case(db, convo_id)
    if case is None:
        raise ApiProblem(
            status.HTTP_403_FORBIDDEN,
            "no_open_case",
            "This conversation has no open flag or report, so it cannot be opened.",
        )
    audit.record(
        db,
        admin,
        "conversation.viewed",
        subject_type="conversation",
        subject_id=convo_id,
        meta={"reason": reason, "case": case},
    )
    db.commit()
    msgs = stream.fetch_channel_messages(convo.stream_channel_id or "")
    return [AdminMessageItem(**m) for m in msgs]


# --- Moderation ---------------------------------------------------------------


@router.get("/moderation/queue", response_model=list[ModerationItem])
def moderation_queue(
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[ModerationItem]:
    events = (
        db.execute(
            select(ModerationEvent)
            .where(ModerationEvent.reviewed.is_(False))
            .order_by(ModerationEvent.created_at.desc())
            .limit(200)
        )
        .scalars()
        .all()
    )
    return [
        ModerationItem(
            id=e.id,
            reporter_id=e.reporter_id,
            reporter_kind=e.reporter_kind.value,
            subject_id=e.subject_id,
            conversation_id=e.conversation_id,
            level=int(e.level.value),
            reason=e.reason,
            blocked=e.blocked,
            reviewed=e.reviewed,
            created_at=e.created_at.isoformat(),
        )
        for e in events
    ]


@router.post("/moderation/{event_id}/resolve", response_model=OkResult)
def resolve_event(
    event_id: str,
    payload: ModerationResolveIn | None = None,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> OkResult:
    """Resolve a report. With an `action` (T3.7) the reported MEMBER is suspended or
    banned in the same transaction — `ModerationLevel.suspension` / `ban` now act:
    their chats end and are sealed, every member route refuses them. Only for
    reports whose subject is a member (filed by a mentor or by the system); 409
    `not_a_member_report` otherwise."""
    event = db.get(ModerationEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    ended: list[str | None] = []
    if payload is not None:
        if event.reporter_kind == ReporterKind.member or not event.subject_id:
            raise ApiProblem(
                status.HTTP_409_CONFLICT,
                "not_a_member_report",
                "This report is not about a member.",
            )
        act = member_status.ban if payload.action == "ban" else member_status.suspend
        try:
            ended = act(db, admin, event.subject_id, reason=payload.reason, until=payload.until)
        except member_status.MemberNotFound:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "member not found") from None
        event.level = ModerationLevel.ban if payload.action == "ban" else ModerationLevel.suspension
    event.reviewed = True
    event.reviewed_by = admin.name
    audit.record(
        db,
        admin,
        "moderation.resolved",
        subject_type="moderation_event",
        subject_id=event_id,
        meta={"action": payload.action} if payload is not None else {},
    )
    db.commit()
    for channel_id in ended:
        conversations.seal(channel_id)
    return OkResult(status="resolved")


@router.post("/listeners/{listener_id}/suspend", response_model=OkResult)
def suspend_listener(
    listener_id: str,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> OkResult:
    li = db.get(ListenerProfile, listener_id)
    if li is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    li.vetting_status = VettingStatus.suspended
    # A suspended mentor can no longer open the console — and must not be able to
    # reach members from a client that is already open. End their active chats (the
    # members are free to be matched again, the slots are released) and seal every
    # channel on Stream once the transaction is committed.
    ended = conversations.end_all_for_listener(db, listener_id)
    # Nobody stays in touch with a mentor the team has removed (DECISIONS §L.6).
    in_touch.end_all_for_listener(db, listener_id)
    audit.record(
        db,
        admin,
        "listener.suspended",
        subject_type="listener",
        subject_id=listener_id,
        meta={"conversations_ended": len(ended)},
    )
    db.commit()
    for channel_id in ended:
        conversations.seal(channel_id)
    return OkResult(status="suspended")


@router.post("/listeners/{listener_id}/clear-line", response_model=OkResult)
def clear_listener_line(
    listener_id: str,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> OkResult:
    """Listeners panel → "Clear line" (spec 2026-09-06 §3.3). The mentor's public
    line goes live without pre-approval on save; this is the moderation backstop —
    same admin gate as suspend, always audited."""
    li = db.get(ListenerProfile, listener_id)
    if li is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    li.public_line = None
    audit.record(
        db, admin, "listener.public_line_cleared", subject_type="listener", subject_id=listener_id
    )
    db.commit()
    return OkResult(status="cleared")


@router.post("/listeners/{listener_id}/reinstate", response_model=OkResult)
def reinstate_listener(
    listener_id: str,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> OkResult:
    li = db.get(ListenerProfile, listener_id)
    if li is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    li.vetting_status = VettingStatus.approved
    # Back on the mentor side: any earlier step-back ask is settled.
    li.step_back_requested_at = None
    li.step_back_reason = None
    audit.record(db, admin, "listener.reinstated", subject_type="listener", subject_id=listener_id)
    db.commit()
    return OkResult(status="reinstated")


# --- Listener management ------------------------------------------------------


@router.post("/listeners/reconcile", response_model=AdminReconcileOut)
def reconcile_listeners(
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminReconcileOut:
    """Heal capacity drift: end stale conversations and recompute every listener's
    active_conversations from real active rows. Safe to run any time."""
    result = reconcile_listener_capacity(db)
    audit.record(db, admin, "listener.capacity_reconciled", subject_type="listener", meta=result)
    db.commit()
    return AdminReconcileOut(**result)


def _listener_item(li: ListenerProfile) -> AdminListenerItem:
    return AdminListenerItem(
        id=li.id,
        persona_name=li.persona_name,
        persona_avatar=li.persona_avatar,
        vetting_status=li.vetting_status.value,
        status=li.status.value,
        categories=li.categories or [],
        active_conversations=li.active_conversations,
        max_concurrent=li.max_concurrent,
        rank=li.rank,
        public_line=li.public_line,
        companion_animal=mentor_face.face(li)[0],
        companion_colour=mentor_face.face(li)[1],
        step_back_requested_at=(
            li.step_back_requested_at.isoformat() if li.step_back_requested_at else None
        ),
        step_back_reason=li.step_back_reason,
    )


@router.get("/listeners", response_model=list[AdminListenerItem])
def admin_listeners(
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[AdminListenerItem]:
    rows = (
        db.execute(select(ListenerProfile).order_by(ListenerProfile.persona_name.asc()))
        .scalars()
        .all()
    )
    # A live mentor waiting to be stepped back is the team's to-do: oldest ask first,
    # above everyone else (the order is otherwise unchanged).
    waiting = sorted(
        (li for li in rows if _awaits_step_back(li)), key=lambda li: li.step_back_requested_at
    )
    rest = [li for li in rows if not _awaits_step_back(li)]
    return [_listener_item(li) for li in [*waiting, *rest]]


def _awaits_step_back(li: ListenerProfile) -> bool:
    return li.step_back_requested_at is not None and li.vetting_status == VettingStatus.approved


@router.post("/listeners", response_model=AdminListenerItem)
def create_listener(
    payload: AdminListenerCreateIn,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminListenerItem:
    persona = generate_persona()
    li = ListenerProfile(
        persona_name=persona.name,
        persona_avatar=persona.avatar,
        categories=payload.categories,
        status=ListenerStatus.offline,
        vetting_status=VettingStatus.approved,
        rank=0,
        active_conversations=0,
        max_concurrent=payload.max_concurrent,
    )
    db.add(li)
    db.flush()
    audit.record(db, admin, "listener.created", subject_type="listener", subject_id=li.id)
    db.commit()
    db.refresh(li)
    item = _listener_item(li)
    # End refresh's transaction BEFORE the outbound Stream call (onboarding's
    # phasing) — without this upsert the listener's first channel creation fails
    # in prod (only seed_listeners upserted until now).
    db.commit()
    stream.upsert_user(item.id, item.persona_name, item.persona_avatar)
    return item


@router.patch("/listeners/{listener_id}", response_model=AdminListenerItem)
def patch_listener(
    listener_id: str,
    payload: AdminListenerPatchIn,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminListenerItem:
    li = db.get(ListenerProfile, listener_id)
    if li is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    if payload.categories is not None:
        li.categories = payload.categories
    if payload.max_concurrent is not None:
        li.max_concurrent = payload.max_concurrent
    if payload.rank is not None:
        li.rank = payload.rank
    audit.record(db, admin, "listener.updated", subject_type="listener", subject_id=listener_id)
    db.commit()
    db.refresh(li)
    return _listener_item(li)


@router.post("/listeners/{listener_id}/console-link", response_model=AdminConsoleLinkOut)
def listener_console_link(
    listener_id: str,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminConsoleLinkOut:
    li = db.get(ListenerProfile, listener_id)
    if li is None or li.vetting_status != VettingStatus.approved:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "approved listener not found")
    token = issue_listener_token(li.id)
    audit.record(db, admin, "listener.link_issued", subject_type="listener", subject_id=listener_id)
    db.commit()
    return AdminConsoleLinkOut(url=mentor_console_link(token))


# --- Listener applications (spec 2026-07-24) ----------------------------------


def _application_item(a: ListenerApplication, persona_name: str) -> AdminApplicationItem:
    return AdminApplicationItem(
        id=a.id,
        persona_name=persona_name,
        motivation=a.motivation,
        communities=a.communities or [],
        availability=a.availability,
        available_times=ordered_times(a.available_times),
        email=a.email,
        mentor_interest=a.mentor_interest,
        status=a.status.value,
        created_at=a.created_at.isoformat(),
    )


@router.get("/applications", response_model=list[AdminApplicationItem])
def admin_applications(
    status_filter: str | None = Query(default=None, alias="status"),
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[AdminApplicationItem]:
    stmt = (
        select(ListenerApplication, User.persona_name)
        .join(User, User.id == ListenerApplication.user_id)
        .order_by(ListenerApplication.created_at.asc())
        .limit(200)
    )
    if status_filter:
        try:
            wanted = ApplicationStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, f"unknown status: {status_filter}"
            )
        stmt = stmt.where(ListenerApplication.status == wanted)
    rows = db.execute(stmt).all()
    return [_application_item(a, persona_name) for a, persona_name in rows]


@router.post("/applications/{app_id}/approve", response_model=AdminApplicationItem)
def approve_application(
    app_id: str,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminApplicationItem:
    """Approve → mint a REAL ListenerProfile (offline, vetting-approved), the same
    shape POST /admin/listeners creates. The member's /me then carries a console link."""
    # Row lock: two admins (or a double-click) racing this check-then-act must not
    # mint two listeners for one applicant — same idiom as apply()'s user-row lock.
    a = db.get(ListenerApplication, app_id, with_for_update=True)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "application not found")
    if a.status != ApplicationStatus.pending:
        raise HTTPException(status.HTTP_409_CONFLICT, "application is not pending")
    applicant = db.get(User, a.user_id)
    if applicant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "applicant no longer exists")

    li = ListenerProfile(
        persona_name=applicant.persona_name,
        persona_avatar=applicant.persona_avatar,
        categories=[],
        community_slug=(a.communities[0] if a.communities else None),
        status=ListenerStatus.offline,
        vetting_status=VettingStatus.approved,
        rank=0,
        active_conversations=0,
        max_concurrent=3,
        # Seeded from the application's own answers (spec 2026-09-06 §3.3): the A37
        # time-of-day chips when there are any ("mornings and weekends"), else the
        # single-choice commitment reworded to a member-facing label
        # (AVAILABILITY_NOTES; unknown drift falls back to the raw text, capped at
        # 60). The mentor can edit it afterwards via PUT /listener/me/profile.
        availability_note=availability_note(a.available_times, a.availability),
    )
    db.add(li)
    db.flush()
    a.status = ApplicationStatus.approved
    a.listener_id = li.id
    audit.record(
        db, admin, "listener.application_approved", subject_type="application", subject_id=a.id
    )
    # TODO(email-provider): when an email service is wired, send the console
    # link to a.email here (spec: store now, send later).
    db.commit()
    db.refresh(a)
    item = _application_item(a, applicant.persona_name)
    new_listener = (a.listener_id, applicant.persona_name, applicant.persona_avatar)
    # End refresh's transaction BEFORE the outbound Stream call (onboarding's
    # phasing) — without this upsert the listener's first channel creation fails
    # in prod (only seed_listeners upserted until now).
    db.commit()
    # The approval is committed; the Stream user is a follow-up. A Stream timeout here
    # used to surface as a 500 over a real approval (and a retry then 409'd). The
    # mentor's first console sign-in re-ensures the user either way.
    stream.ensure_user(*new_listener)
    return item


@router.post("/applications/{app_id}/decline", response_model=AdminApplicationItem)
def decline_application(
    app_id: str,
    payload: AdminApplicationDeclineIn,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminApplicationItem:
    """Decline with an admin-private reason — stored for our records, never
    surfaced to the member (T&S: no wound-poking)."""
    # Row lock: an approve racing this decline must not leave a declined row with
    # a live listener — same idiom as apply()'s user-row lock.
    a = db.get(ListenerApplication, app_id, with_for_update=True)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "application not found")
    if a.status != ApplicationStatus.pending:
        raise HTTPException(status.HTTP_409_CONFLICT, "application is not pending")
    applicant = db.get(User, a.user_id)
    a.status = ApplicationStatus.declined
    a.decline_reason = payload.reason
    audit.record(
        db, admin, "listener.application_declined", subject_type="application", subject_id=a.id
    )
    db.commit()
    db.refresh(a)
    return _application_item(a, applicant.persona_name if applicant else "(deleted)")


# --- Health + contributions ---------------------------------------------------


@router.get("/health/deep", response_model=AdminHealthOut)
def health_deep(
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminHealthOut:
    db_ok = True
    try:
        db.execute(select(func.count()).select_from(AdminAccount))
    except Exception:
        db_ok = False
    redis_ok = True
    last_webhook = None
    try:
        from app import ratelimit

        r = ratelimit._redis()
        r.ping()
        last_webhook = r.get("mento:last_webhook_at")
    except Exception:
        redis_ok = False
    return AdminHealthOut(
        db_ok=db_ok,
        redis_ok=redis_ok,
        stream_configured=stream.is_configured(),
        last_webhook_at=last_webhook,
        rate_limiter_ok=redis_ok,
    )


# --- Message allowance (DECISIONS §L.2, board A13) — numbers only ----------------


@router.get("/allowance", response_model=AdminAllowanceOut)
def allowance_counts(
    days: int = Query(14, ge=1, le=30),
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminAllowanceOut:
    """How the message allowance is landing, per IST day: messages sent, how many
    members met the 3-in-a-row pause or the daily limit, and crisis-exempt sends.
    Aggregates only — never text, names, or WHO (T&S #10). The read is audited."""
    settings = get_settings()
    rows = [
        AdminAllowanceDay(
            day=c.day.isoformat(),
            messages_sent=c.messages_sent,
            crisis_exempt_sends=c.crisis_exempt_sends,
            in_a_row_pauses=c.in_a_row_pauses,
            members_paused_in_a_row=c.members_paused_in_a_row,
            daily_cap_holds=c.daily_cap_holds,
            members_reached_daily_cap=c.members_reached_daily_cap,
        )
        for c in allowance.daily_counts(db, days)
    ]
    totals = AdminAllowanceDay(
        day=f"{rows[0].day}/{rows[-1].day}",
        messages_sent=sum(r.messages_sent for r in rows),
        crisis_exempt_sends=sum(r.crisis_exempt_sends for r in rows),
        in_a_row_pauses=sum(r.in_a_row_pauses for r in rows),
        members_paused_in_a_row=sum(r.members_paused_in_a_row for r in rows),
        daily_cap_holds=sum(r.daily_cap_holds for r in rows),
        members_reached_daily_cap=sum(r.members_reached_daily_cap for r in rows),
    )
    audit.record(db, admin, "allowance.viewed", subject_type="allowance", meta={"days": days})
    db.commit()
    return AdminAllowanceOut(
        rule=AdminAllowanceRule(
            in_a_row=settings.allowance_in_a_row,
            per_day=settings.allowance_per_day,
            enforced=settings.allowance_enforced and settings.allowance_enabled,
            crisis_exempt_hours=settings.allowance_crisis_exempt_hours,
            timezone="Asia/Kolkata",
        ),
        days=rows,
        totals=totals,
    )


# --- Product feedback (board A11) -----------------------------------------------


@router.get("/feedback", response_model=AdminFeedbackOut)
def admin_feedback(
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    category: str | None = Query(None, pattern="^(broken|confusing|idea)$"),
    role: str | None = Query(None, pattern="^(member|mentor)$"),
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminFeedbackOut:
    """What people told the team, newest first. A row has no author — only which side
    of the app it came from. People write freely in that box, so the read is audited."""
    where = []
    if category:
        where.append(ProductFeedback.category == category)
    if role:
        where.append(ProductFeedback.role == role)
    total = db.execute(select(func.count()).select_from(ProductFeedback).where(*where)).scalar_one()
    rows = db.scalars(
        select(ProductFeedback)
        .where(*where)
        .order_by(ProductFeedback.created_at.desc(), ProductFeedback.id)
        .limit(limit)
        .offset(offset)
    ).all()
    audit.record(
        db,
        admin,
        "feedback.viewed",
        subject_type="feedback",
        meta={"limit": limit, "offset": offset, "category": category, "role": role},
    )
    db.commit()
    return AdminFeedbackOut(
        total=total,
        limit=limit,
        offset=offset,
        items=[
            AdminFeedbackItem(
                id=f.id,
                created_at=f.created_at.isoformat(),
                role=f.role,
                category=f.category,
                text=f.text,
                screen=f.screen,
                app_version=f.app_version,
            )
            for f in rows
        ],
    )


@router.get("/contributions", response_model=list[AdminContributionItem])
def admin_contributions(
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[AdminContributionItem]:
    # Razorpay not wired yet — the table schema is ready; ships empty until then.
    from app.models.contribution import Contribution

    rows = (
        db.execute(select(Contribution).order_by(Contribution.created_at.desc()).limit(200))
        .scalars()
        .all()
    )
    return [
        AdminContributionItem(
            id=c.id,
            amount_paise=c.amount_paise,
            status=c.status,
            created_at=c.created_at.isoformat(),
        )
        for c in rows
    ]


# --- Admins management (owner-only) + audit -----------------------------------


@router.get("/admins", response_model=list[AdminAccountItem], dependencies=[Depends(require_owner)])
def list_admins(db: Session = Depends(get_db)) -> list[AdminAccountItem]:
    rows = db.execute(select(AdminAccount).order_by(AdminAccount.created_at.asc())).scalars().all()
    return [
        AdminAccountItem(
            id=a.id,
            name=a.name,
            role=a.role.value,
            status=a.status.value,
            created_at=a.created_at.isoformat(),
        )
        for a in rows
    ]


@router.post("/admins", response_model=AdminCreatedOut)
def create_admin(
    payload: AdminCreateIn,
    owner: AdminAccount = Depends(require_owner),
    db: Session = Depends(get_db),
) -> AdminCreatedOut:
    a = AdminAccount(name=payload.name, role=AdminRole.helper, created_by=owner.id)
    db.add(a)
    db.flush()
    audit.record(db, owner, "admin.created", subject_type="admin", subject_id=a.id)
    db.commit()
    db.refresh(a)
    token = issue_admin_token(a.id)
    return AdminCreatedOut(id=a.id, url=admin_link(token))


@router.post("/admins/{admin_id}/revoke", response_model=OkResult)
def revoke_admin(
    admin_id: str,
    owner: AdminAccount = Depends(require_owner),
    db: Session = Depends(get_db),
) -> OkResult:
    a = db.get(AdminAccount, admin_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "admin not found")
    if a.id == owner.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot revoke yourself")
    a.status = AdminStatus.revoked
    audit.record(db, owner, "admin.revoked", subject_type="admin", subject_id=admin_id)
    db.commit()
    return OkResult(status="revoked")


@router.get("/audit", response_model=list[AdminAuditItem])
def audit_log(
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[AdminAuditItem]:
    rows = (
        db.execute(select(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(200))
        .scalars()
        .all()
    )
    return [
        AdminAuditItem(
            id=a.id,
            admin_name=a.admin_name,
            action=a.action,
            subject_type=a.subject_type,
            subject_id=a.subject_id,
            created_at=a.created_at.isoformat(),
        )
        for a in rows
    ]
