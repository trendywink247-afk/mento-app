"""Listener matching. General → next-available; Personal → directed (deferred accept)."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.conversation import Conversation
from app.models.enums import (
    ConversationEndedBy,
    ConversationStatus,
    ConversationType,
    ListenerStatus,
    RequestStatus,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.moderation import ModerationEvent
from app.models.request import ConversationRequest
from app.models.user import User
from app.services import stream


class NoListenerAvailable(Exception):
    """No approved, online listener has spare capacity right now."""


class RequestNotPending(Exception):
    """The request doesn't exist, isn't pending, or isn't addressed to the actor."""


class ListenerAtCapacity(Exception):
    """The target listener has no spare capacity right now."""


def _blocked_listener_ids(db: Session, user_id: str) -> set[str]:
    """Listeners this user has blocked — never re-match them (Trust & Safety #9)."""
    rows = (
        db.execute(
            select(ModerationEvent.subject_id).where(
                ModerationEvent.reporter_id == user_id,
                ModerationEvent.blocked.is_(True),
            )
        )
        .scalars()
        .all()
    )
    return set(rows)


def _own_listener_ids(db: Session, user_id: str) -> set[str]:
    """Listener profiles minted from this user's own applications (session 22
    funnel) — a member who became a listener must never be paired with themself."""
    rows = (
        db.execute(
            select(ListenerApplication.listener_id).where(
                ListenerApplication.user_id == user_id,
                ListenerApplication.listener_id.is_not(None),
            )
        )
        .scalars()
        .all()
    )
    return set(rows)


def _pick_available_listener(
    db: Session,
    category: str | None,
    blocked_ids: set[str],
    community: str | None = None,
) -> ListenerProfile | None:
    """Lowest current load, then highest rank; community + category preferred (in
    Python — portable across JSON/JSONB); blocked listeners excluded. Community is a
    SOFT preference (community+category > community > category > rest) — the pool is
    small, never strand a user for want of a same-road listener.

    Two-step locking so concurrent matchers never contend on the whole candidate set:
    an UNLOCKED preview ranks up to 10 candidates, then we lock ONLY the one we take
    (`FOR UPDATE SKIP LOCKED`, availability re-checked under the lock — the preview may
    be stale). Locking all 10 made competitors skip every locked candidate and 503
    spuriously, and (worse) the lock used to be held across the Stream HTTP call.
    """
    preview = db.execute(
        select(ListenerProfile.id, ListenerProfile.categories, ListenerProfile.community_slug)
        .where(
            ListenerProfile.vetting_status == VettingStatus.approved,
            ListenerProfile.status == ListenerStatus.online,
            ListenerProfile.active_conversations < ListenerProfile.max_concurrent,
        )
        .order_by(ListenerProfile.active_conversations.asc(), ListenerProfile.rank.desc())
        .limit(10)
    ).all()
    ranked = [(lid, cats, comm) for lid, cats, comm in preview if lid not in blocked_ids]

    def _tier(cats: list[str] | None, comm: str | None) -> int:
        community_hit = bool(community) and comm == community
        category_hit = bool(category) and category in (cats or [])
        if community_hit and category_hit:
            return 0
        if community_hit:
            return 1
        if category_hit:
            return 2
        return 3

    # Stable sort preserves the load/rank ordering inside each tier.
    ordered = [lid for lid, _, _ in sorted(ranked, key=lambda r: _tier(r[1], r[2]))]

    for listener_id in ordered:
        locked = db.execute(
            select(ListenerProfile)
            .where(
                ListenerProfile.id == listener_id,
                ListenerProfile.vetting_status == VettingStatus.approved,
                ListenerProfile.status == ListenerStatus.online,
                ListenerProfile.active_conversations < ListenerProfile.max_concurrent,
            )
            .with_for_update(skip_locked=True)
        ).scalar_one_or_none()
        if locked is not None:
            return locked
    return None


def open_conversation(
    db: Session,
    user_id: str,
    listener: ListenerProfile,
    *,
    issue_category: str | None = None,
    before_commit: Callable[[Conversation], None] | None = None,
    on_stream_failure: Callable[[], None] | None = None,
) -> Conversation:
    """Open a conversation with a listener whose row the CALLER holds locked.

    Three short phases so the row lock never spans an HTTP call:
      1. Reserve capacity + insert the Conversation (+ caller state via
         `before_commit`) and COMMIT — the lock is released in microseconds and the
         reservation is durable, so concurrent matchers can't double-assign.
      2. Create the Stream channel OUTSIDE any transaction.
      3. Persist the channel id — or, on Stream failure, compensate (release the
         reserved slot atomically, drop the conversation, run `on_stream_failure`).
    """
    listener.active_conversations += 1
    convo = Conversation(
        type=ConversationType.anon,
        status=ConversationStatus.active,
        user_id=user_id,
        listener_id=listener.id,
        # Free text today (nothing here validates it against ISSUE_CATEGORIES).
        # MatchRequest/PersonalRequestIn already cap issue_category at 40 chars
        # (a 41-char value is a 422 at the API boundary) — this slice is
        # belt-and-braces for any other caller of open_conversation, so the
        # column (40 chars) can never overflow regardless of the request path.
        issue_category=issue_category[:40] if issue_category else None,
    )
    db.add(convo)
    db.flush()  # assign convo.id
    if before_commit is not None:
        before_commit(convo)
    db.commit()

    try:
        channel_id = stream.create_dm_channel(
            channel_id=f"c-{uuid.uuid4().hex[:20]}",
            user_id=user_id,
            listener_id=listener.id,
        )
    except Exception:
        db.execute(
            update(ListenerProfile)
            .where(ListenerProfile.id == listener.id, ListenerProfile.active_conversations > 0)
            .values(active_conversations=ListenerProfile.active_conversations - 1)
        )
        db.delete(convo)
        if on_stream_failure is not None:
            on_stream_failure()
        db.commit()
        raise

    convo.stream_channel_id = channel_id
    db.commit()
    db.refresh(convo)
    return convo


def release_listener_slot(db: Session, convo: Conversation) -> None:
    """Free the listener's slot with an atomic UPDATE (same pattern as the
    compensation path above) — a Python read-modify-write would lose decrements
    under concurrent end/wipe/report/block. Callers invoke this ONLY on the
    active → ended/wiped transition, so a slot is never released twice."""
    db.execute(
        update(ListenerProfile)
        .where(
            ListenerProfile.id == convo.listener_id,
            ListenerProfile.active_conversations > 0,
        )
        .values(active_conversations=ListenerProfile.active_conversations - 1)
    )


PRESENCE_STALE_AFTER = timedelta(minutes=15)


def sweep_stale_presence(db: Session, *, now: datetime | None = None) -> int:
    """Auto-away safety net (spec 2026-09-05 §6): an ONLINE listener whose native
    console stopped heartbeating more than PRESENCE_STALE_AFTER ago is marked away,
    so General matching never hands a member to someone who left. Rows with
    last_seen_at IS NULL are untracked (seeds, the web console) and are left alone.
    The CALLER commits. Returns the number of listeners flipped."""
    cutoff = (now or datetime.now(UTC)) - PRESENCE_STALE_AFTER
    result = db.execute(
        update(ListenerProfile)
        .where(
            ListenerProfile.status == ListenerStatus.online,
            ListenerProfile.last_seen_at.is_not(None),
            ListenerProfile.last_seen_at < cutoff,
        )
        .values(status=ListenerStatus.away)
    )
    return result.rowcount


def match_general(db: Session, user: User, category: str | None = None) -> Conversation:
    """Match the user to the next available listener and open a Stream channel."""
    sweep_stale_presence(db)
    db.commit()
    blocked_ids = _blocked_listener_ids(db, user.id) | _own_listener_ids(db, user.id)
    listener = _pick_available_listener(db, category, blocked_ids, community=user.community_slug)
    if listener is None:
        # Self-heal before giving up. Prod finding (2026-09-06): every slot was held
        # by abandoned chats older than conversation_max_age_hours, and the sweep
        # only ran when an admin pressed Reconcile — so a member was told "all our
        # mentors are with someone" for a day. Retry once only if the sweep
        # actually freed something; a genuinely full pool still 503s.
        healed = reconcile_listener_capacity(db)
        db.commit()
        if any(healed.values()):
            listener = _pick_available_listener(
                db, category, blocked_ids, community=user.community_slug
            )
    if listener is None:
        raise NoListenerAvailable()
    return open_conversation(db, user.id, listener, issue_category=category)


def _pending_request(
    db: Session, request_id: str, acting_listener_id: str | None
) -> ConversationRequest:
    req = db.get(ConversationRequest, request_id)
    if req is None or req.status != RequestStatus.pending:
        raise RequestNotPending()
    # A listener may only act on requests addressed to them; the admin path
    # (acting_listener_id=None) may act on any. Not-mine is opaquely "not found".
    if acting_listener_id is not None and req.target_listener_id != acting_listener_id:
        raise RequestNotPending()
    return req


def accept_personal_request(
    db: Session, request_id: str, *, acting_listener_id: str | None = None
) -> ConversationRequest:
    """Accept a Personal request under a row lock so capacity can't double-assign.
    Shared by the admin stand-in and the listener console."""
    req = _pending_request(db, request_id, acting_listener_id)

    listener = db.execute(
        select(ListenerProfile)
        .where(ListenerProfile.id == req.target_listener_id)
        .with_for_update()
    ).scalar_one_or_none()
    if listener is None or listener.active_conversations >= listener.max_concurrent:
        raise ListenerAtCapacity()

    def _mark_matched(convo: Conversation) -> None:
        # Same transaction as the capacity reservation — request state and slot
        # can never disagree.
        req.status = RequestStatus.matched
        req.conversation_id = convo.id

    def _revert_request() -> None:
        req.status = RequestStatus.pending
        req.conversation_id = None

    open_conversation(
        db,
        req.requester_id,
        listener,
        issue_category=req.issue_category,
        before_commit=_mark_matched,
        on_stream_failure=_revert_request,
    )
    db.refresh(req)
    return req


def decline_personal_request(
    db: Session, request_id: str, *, acting_listener_id: str | None = None
) -> None:
    req = _pending_request(db, request_id, acting_listener_id)
    req.status = RequestStatus.declined
    db.commit()


def reconcile_listener_capacity(db: Session) -> dict[str, int]:
    """Heal capacity drift and slot leaks in one pass. The CALLER commits, so an
    admin audit record can land in the same transaction.

    1. Sweep stale conversations: anything active longer than
       `conversation_max_age_hours` (abandoned chats, crashes between
       open_conversation's phases) is marked ended.
    2. Recompute every listener's `active_conversations` from the actual count of
       active Conversation rows — one atomic UPDATE with a correlated subquery, so
       a hand-drifted counter can't survive.

    3. Sweep stale presence (see sweep_stale_presence) — a listener whose native
       console stopped heartbeating over 15 minutes ago is marked away.

    Returns counts for the admin console: {"stale_ended": n, "listeners_corrected": n,
    "presence_swept": n}.
    """
    max_age = timedelta(hours=get_settings().conversation_max_age_hours)
    cutoff = datetime.now(UTC) - max_age
    stale = db.execute(
        update(Conversation)
        .where(
            Conversation.status == ConversationStatus.active,
            Conversation.created_at < cutoff,
        )
        .values(
            status=ConversationStatus.ended,
            ended_at=datetime.now(UTC),
            ended_by=ConversationEndedBy.system,
        )
    )

    # True per-listener load, computed in SQL. COUNT over zero rows is 0, so
    # listeners with no active conversations reset cleanly.
    active_count = (
        select(func.count())
        .select_from(Conversation)
        .where(
            Conversation.listener_id == ListenerProfile.id,
            Conversation.status == ConversationStatus.active,
        )
        .correlate(ListenerProfile)
        .scalar_subquery()
    )
    corrected = db.execute(
        update(ListenerProfile)
        .where(ListenerProfile.active_conversations != active_count)
        .values(active_conversations=active_count)
    )
    swept = sweep_stale_presence(db)
    return {
        "stale_ended": stale.rowcount,
        "listeners_corrected": corrected.rowcount,
        "presence_swept": swept,
    }
