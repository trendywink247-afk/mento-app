"""Minimal listener console (DECISIONS §I.6) — the surface where a REAL human
listener answers chats before the Module B portal exists.

Auth: a role-claimed JWT from scripts/issue_listener_token (shared as a link, no
password). Revocation is the per-request vetting check below: flip a listener to
suspended and every outstanding link dies instantly.

Anonymity holds on both sides (T&S #7): the listener sees member PERSONAS only,
and none of the member's privacy controls (lock/mask/PIN are the member's).
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, select
from sqlalchemy.orm import Session

from app import jobs, ratelimit
from app.config import get_settings
from app.db import get_db
from app.errors import ApiProblem
from app.jobs import tasks
from app.models.conversation import Conversation
from app.models.enums import (
    ConversationEndedBy,
    ConversationStatus,
    ListenerStatus,
    ModerationLevel,
    PushOwnerKind,
    ReporterKind,
    RequestStatus,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.moderation import ModerationEvent
from app.models.request import ConversationRequest
from app.models.safety import SafetyFlag
from app.models.user import User
from app.schemas import (
    DevListenerItem,
    DevTokenOut,
    ListenerConversationItem,
    ListenerMeOut,
    ListenerProfileEditIn,
    ListenerReportIn,
    ListenerRequestItem,
    ListenerStatusIn,
    MemberBriefOut,
    OkResult,
    PushTokenDeleteIn,
    PushTokenIn,
    RequestOut,
    SnoozeOut,
)
from app.security import current_listener_id, issue_listener_token
from app.services import (
    care_prompts,
    categories,
    conversations,
    in_touch,
    mentor_face,
    mentor_names,
    paths,
    push,
    snooze,
    stream,
)
from app.services.matching import (
    ListenerAtCapacity,
    RequestNotPending,
    accept_personal_request,
    decline_personal_request,
)

router = APIRouter(prefix="/listener", tags=["listener-console"])


def current_listener(
    listener_id: str = Depends(current_listener_id),
    db: Session = Depends(get_db),
) -> ListenerProfile:
    """Load the authenticated listener; approval is checked on EVERY request so
    suspension revokes all outstanding token links immediately."""
    listener = db.get(ListenerProfile, listener_id)
    if listener is None or listener.vetting_status != VettingStatus.approved:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "listener access revoked")
    return listener


def _me_out(li: ListenerProfile) -> ListenerMeOut:
    return ListenerMeOut(
        id=li.id,
        persona_name=li.persona_name,
        persona_avatar=li.persona_avatar,
        status=li.status.value,
        categories=li.categories or [],
        active_conversations=li.active_conversations,
        max_concurrent=li.max_concurrent,
        stream_token=stream.user_token(li.id),
        public_line=li.public_line,
        availability_note=li.availability_note,
        name_changes_at=(
            mentor_names.next_rotation_at(datetime.now(UTC)).isoformat()
            if mentor_names.is_enabled()
            else None
        ),
        companion_animal=mentor_face.face(li)[0],
        companion_colour=mentor_face.face(li)[1],
    )


# --- Dev-only convenience: pick a listener without a token link ---------------
# The console is token-link-authed by design (no login, for anonymity — DECISIONS
# §I.6). That's correct for production but a chore while testing. These two routes
# let a developer open /listener and click a seeded listener to enter. They 404
# outside dev (settings.env != "dev"), so the production auth story is untouched.


def _require_dev() -> None:
    if not get_settings().is_dev:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")


@router.get(
    "/dev/roster",
    response_model=list[DevListenerItem],
    dependencies=[Depends(_require_dev)],
)
def dev_roster(db: Session = Depends(get_db)) -> list[DevListenerItem]:
    rows = (
        db.execute(
            select(ListenerProfile)
            .where(ListenerProfile.vetting_status == VettingStatus.approved)
            .order_by(ListenerProfile.persona_name.asc())
        )
        .scalars()
        .all()
    )
    return [
        DevListenerItem(
            id=li.id,
            persona_name=li.persona_name,
            persona_avatar=li.persona_avatar,
            status=li.status.value,
            companion_animal=mentor_face.face(li)[0],
            companion_colour=mentor_face.face(li)[1],
        )
        for li in rows
    ]


@router.post(
    "/dev/token/{listener_id}",
    response_model=DevTokenOut,
    dependencies=[Depends(_require_dev)],
)
def dev_token(listener_id: str, db: Session = Depends(get_db)) -> DevTokenOut:
    listener = db.get(ListenerProfile, listener_id)
    if listener is None or listener.vetting_status != VettingStatus.approved:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    return DevTokenOut(token=issue_listener_token(listener.id))


@router.get("/me", response_model=ListenerMeOut, dependencies=[Depends(mentor_names.fresh_names)])
def me(listener: ListenerProfile = Depends(current_listener)) -> ListenerMeOut:
    return _me_out(listener)


@router.patch("/me/status", response_model=ListenerMeOut)
def set_status(
    payload: ListenerStatusIn,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> ListenerMeOut:
    """online/away — directly gates General matching (its query filters on online)."""
    ratelimit.enforce(
        f"listener-status:{listener.id}",
        30,
        600,
        detail="Too many status changes — try again in a few minutes.",
    )
    listener.status = ListenerStatus(payload.status)
    if listener.status == ListenerStatus.online:
        # Tracking (re)starts with the next heartbeat — see matching.sweep_stale_presence.
        listener.last_seen_at = None
    db.commit()
    db.refresh(listener)
    return _me_out(listener)


@router.put("/me/profile", response_model=ListenerMeOut)
def update_profile(
    payload: ListenerProfileEditIn,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> ListenerMeOut:
    """The mentor's "Your line" editor (spec 2026-09-06 §3.3). PATCH semantics on
    a PUT: only fields PRESENT in the request body are touched (`model_fields_set`),
    so omitting a field leaves it unchanged — the member's line and availability
    note are edited independently from the console sheet. A present field is
    whitespace-collapsed (`" ".join(value.split())`, which also strips newlines)
    and trimmed; an empty result is stored as NULL, never an empty string."""
    ratelimit.enforce(
        f"listener-profile:{listener.id}",
        10,
        3600,
        detail="Too many profile edits — try again in a bit.",
    )
    fields = payload.model_fields_set
    if "public_line" in fields:
        value = payload.public_line
        listener.public_line = (" ".join(value.split()) if value else "") or None
    if "availability_note" in fields:
        value = payload.availability_note
        listener.availability_note = (" ".join(value.split()) if value else "") or None
    db.commit()
    db.refresh(listener)
    return _me_out(listener)


@router.post("/me/heartbeat", response_model=OkResult)
def heartbeat(
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> OkResult:
    """Native console presence pulse (every 5 min while focused + online). The
    sweep in services/matching marks a listener away 15 min after the last one."""
    ratelimit.enforce(
        f"listener-heartbeat:{listener.id}", 30, 600, detail="Slow down — heartbeat limit reached."
    )
    listener.last_seen_at = datetime.now(UTC)
    db.commit()
    return OkResult(status="ok")


@router.post("/me/push-token", response_model=dict)
def register_push_token(
    payload: PushTokenIn,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> dict:
    """Mentor device registration (spec 2026-09-05 push §3). Same upsert as the
    member path; `current_listener` already refuses suspended profiles."""
    ratelimit.enforce(
        f"push-token-listener:{listener.id}",
        20,
        3600,
        detail="Too many token registrations — please wait a moment.",
    )
    push.upsert_token(
        db, PushOwnerKind.listener, listener.id, payload.expo_push_token, payload.platform
    )
    return {"status": "registered"}


@router.get("/me/conversations", response_model=list[ListenerConversationItem])
def my_conversations(
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> list[ListenerConversationItem]:
    """Active first, newest within each group — ordered IN SQL, so the page limit can
    never cut an old conversation that is still active (a Python sort after a
    newest-first LIMIT would)."""
    now = datetime.now(UTC)
    rows = db.execute(
        select(Conversation, User)
        .join(User, User.id == Conversation.user_id)
        .where(Conversation.listener_id == listener.id)
        .order_by(
            # Active and awake first, then active but snoozed (board A10), then ended.
            case(
                (
                    and_(
                        Conversation.status == ConversationStatus.active,
                        Conversation.snoozed_until.is_not(None),
                        Conversation.snoozed_until > now,
                    ),
                    1,
                ),
                (Conversation.status == ConversationStatus.active, 0),
                else_=2,
            ),
            Conversation.created_at.desc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()
    linked = in_touch.listener_in_touch_user_ids(db, listener.id, {user.id for _c, user in rows})
    return [
        ListenerConversationItem(
            id=convo.id,
            status=convo.status.value,
            user_persona_name=user.persona_name,
            user_persona_avatar=user.persona_avatar,
            stream_channel_id=convo.stream_channel_id,
            member_masked=convo.status_mask is not None,
            created_at=convo.created_at.isoformat(),
            ended_at=convo.ended_at.isoformat() if convo.ended_at else None,
            in_touch=user.id in linked,
            snoozed_until=snooze.snoozed_until_iso(convo, now),
            user_companion_animal=user.companion_animal,
            user_companion_colour=user.companion_colour,
        )
        for convo, user in rows
    ]


@router.get("/me/requests", response_model=list[ListenerRequestItem])
def my_pending_requests(
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> list[ListenerRequestItem]:
    rows = db.execute(
        select(ConversationRequest, User)
        .join(User, User.id == ConversationRequest.requester_id)
        .where(
            ConversationRequest.target_listener_id == listener.id,
            ConversationRequest.status == RequestStatus.pending,
        )
        .order_by(ConversationRequest.created_at.asc())
    ).all()
    # The member's letter lights "Seen" from here and nowhere else (board A04): the
    # question is in front of the mentor who was asked. Stamped once, on this mentor's own
    # pending requests, and never moved afterwards.
    now = datetime.now(UTC)
    stamped = False
    for req, _user in rows:
        if req.seen_at is None:
            req.seen_at = now
            stamped = True
    if stamped:
        db.commit()
    return [
        ListenerRequestItem(
            id=req.id,
            intro_message=req.intro_message,
            issue_category=req.issue_category,
            requester_persona_name=user.persona_name,
            created_at=req.created_at.isoformat(),
            requester_companion_animal=user.companion_animal,
            requester_companion_colour=user.companion_colour,
            issue_category_label=categories.label(req.issue_category),
        )
        for req, user in rows
    ]


@router.post("/me/requests/{request_id}/accept", response_model=RequestOut)
def accept(
    request_id: str,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> RequestOut:
    """Same row-locked capacity path as General matching — no double-assignment."""
    try:
        req = accept_personal_request(db, request_id, acting_listener_id=listener.id)
    except RequestNotPending:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pending request not found") from None
    except ListenerAtCapacity:
        raise HTTPException(status.HTTP_409_CONFLICT, "you're at capacity right now") from None
    # The accept committed inside the matcher; the push job is its own small write.
    jobs.enqueue(db, tasks.push_request_accepted, best_effort=True, request_id=req.id)
    db.commit()
    return RequestOut(
        id=req.id,
        status=req.status.value,
        target_listener_id=req.target_listener_id,
        intro_message=req.intro_message,
        conversation_id=req.conversation_id,
        created_at=req.created_at.isoformat(),
        # The member's letter reads its strip off these (board A04).
        seen_at=req.seen_at.isoformat() if req.seen_at else None,
        replying=req.status == RequestStatus.matched,
    )


@router.post("/me/requests/{request_id}/decline", response_model=OkResult)
def decline(
    request_id: str,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> OkResult:
    try:
        decline_personal_request(db, request_id, acting_listener_id=listener.id)
    except RequestNotPending:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "pending request not found") from None
    return OkResult(status="declined")


def _owned_conversation(db: Session, convo_id: str, listener: ListenerProfile) -> Conversation:
    """Only this listener's conversations; anything else is opaquely 404."""
    convo = db.get(Conversation, convo_id)
    if convo is None or convo.listener_id != listener.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    return convo


@router.get("/me/conversations/{convo_id}/brief", response_model=MemberBriefOut)
def member_brief(
    convo_id: str,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> MemberBriefOut:
    """Mentee brief, "Context for care" (spec 2026-09-06 §4.2-4.5). Anonymous
    persona + companion + coarse Path lens + topic + a deterministic care prompt
    — never age, email, or identity (T&S #7)."""
    convo = _owned_conversation(db, convo_id, listener)
    member = db.get(User, convo.user_id)
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")

    safety_flags_open = db.execute(
        select(func.count())
        .select_from(SafetyFlag)
        .where(SafetyFlag.conversation_id == convo.id, SafetyFlag.reviewed.is_(False))
    ).scalar_one()

    last_message_at = (
        stream.channel_last_message_at(convo.stream_channel_id) if convo.stream_channel_id else None
    )

    return MemberBriefOut(
        persona_name=member.persona_name,
        persona_avatar=member.persona_avatar,
        companion_animal=member.companion_animal,
        companion_colour=member.companion_colour,
        community_slug=member.community_slug,
        community_label=paths.community_label(member.community_slug),
        journey_stage=member.journey_stage,
        journey_stage_label=paths.stage_label(member.community_slug, member.journey_stage),
        issue_category=convo.issue_category,
        issue_category_label=categories.label(convo.issue_category),
        created_at=convo.created_at.isoformat(),
        last_message_at=last_message_at.isoformat() if last_message_at else None,
        member_masked=convo.status_mask is not None,
        safety_flags_open=safety_flags_open,
        care_prompt=care_prompts.pick(convo.issue_category, convo.id),
        in_touch=bool(in_touch.listener_in_touch_user_ids(db, listener.id, {member.id})),
    )


@router.post("/me/conversations/{convo_id}/report", response_model=OkResult)
def report_conversation(
    convo_id: str,
    payload: ListenerReportIn,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> OkResult:
    """Mentor rail → Report. Files an unreviewed moderation event against the
    MEMBER (subject) with the listener as reporter. The chat stays open — human
    review decides (T&S #9 layered moderation). The response carries nothing
    about the member."""
    ratelimit.enforce(
        f"listener-report:{listener.id}",
        10,
        3600,
        detail="Too many reports — please try again later.",
    )
    convo = _owned_conversation(db, convo_id, listener)
    reason = payload.reason.value if not payload.note else f"{payload.reason.value}: {payload.note}"
    db.add(
        ModerationEvent(
            reporter_id=listener.id,
            reporter_kind=ReporterKind.listener,
            subject_id=convo.user_id,
            conversation_id=convo.id,
            level=ModerationLevel.warning,
            reason=reason,
            blocked=False,
            reviewed=False,
        )
    )
    # A report — from either side — ends any stay-in-touch link between the two.
    in_touch.end_for_pair(db, convo.user_id, listener.id)
    db.commit()
    return OkResult(status="reported")


@router.post("/me/conversations/{convo_id}/end", response_model=OkResult)
def end_conversation(
    convo_id: str,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> OkResult:
    """Mentor header menu → End. Same atomic slot release as the member end path;
    idempotent, so a double tap or a concurrent member end never double-releases."""
    convo = conversations.lock(db, convo_id)
    if convo is None or convo.listener_id != listener.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    conversations.end(db, convo, ConversationEndedBy.listener)
    db.commit()
    return OkResult(status="ended")


def _snooze_target(db: Session, convo_id: str, listener: ListenerProfile) -> Conversation:
    """Row-locked, this mentor's own, ACTIVE conversation — or an opaque 404 (someone
    else's) / 409 `not_active` (ended or wiped: nothing to snooze)."""
    ratelimit.enforce(
        f"listener-snooze:{listener.id}",
        30,
        3600,
        detail="Too many snooze changes — try again in a little while.",
    )
    convo = conversations.lock(db, convo_id)
    if convo is None or convo.listener_id != listener.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    if convo.status != ConversationStatus.active:
        raise ApiProblem(
            status.HTTP_409_CONFLICT, "not_active", "This conversation has already ended."
        )
    return convo


@router.post("/me/conversations/{convo_id}/snooze", response_model=SnoozeOut)
def snooze_conversation(
    convo_id: str,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> SnoozeOut:
    """Board A10 "Snooze 24 h" — the mentor's "I can't reply today" for one chat. No
    pushes for it and no stale sweep while it lasts; a crisis-flagged member message
    or the mentor's own reply ends it (services/snooze.py). Idempotent: snoozing again
    never extends the window."""
    convo = _snooze_target(db, convo_id, listener)
    until = snooze.snooze(convo)
    db.commit()
    return SnoozeOut(id=convo_id, snoozed_until=until.isoformat())


@router.delete("/me/conversations/{convo_id}/snooze", response_model=SnoozeOut)
def wake_conversation(
    convo_id: str,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> SnoozeOut:
    """Undo a snooze. Idempotent."""
    convo = _snooze_target(db, convo_id, listener)
    snooze.wake(convo)
    db.commit()
    return SnoozeOut(id=convo_id, snoozed_until=None)


@router.delete("/me/push-token", response_model=OkResult)
def delete_push_token(
    payload: PushTokenDeleteIn,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> OkResult:
    """Start Fresh on a device that also held a mentor session: drop the mentor's
    push row too (session 31f device finding — the member-only delete left a
    listener-owned token receiving pushes with no session to route the tap)."""
    push.delete_token(db, PushOwnerKind.listener, listener.id, payload.expo_push_token)
    return OkResult(status="ok")
