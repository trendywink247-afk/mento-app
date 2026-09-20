"""Listener matching. General → next-available; Personal → directed (deferred accept)."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, func, or_, select, update
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

logger = logging.getLogger("mento.matching")


class NoListenerAvailable(Exception):
    """No approved, online listener has spare capacity right now."""


class RequestNotPending(Exception):
    """The request doesn't exist, isn't pending, or isn't addressed to the actor."""


class ListenerAtCapacity(Exception):
    """The target listener has no spare capacity right now."""


def blocked_listener_ids(db: Session, user_id: str) -> set[str]:
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


def own_listener_ids(db: Session, user_id: str) -> set[str]:
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
# An active conversation with no Stream channel after this long is a crashed match.
ORPHAN_GRACE = timedelta(minutes=2)


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
    blocked_ids = blocked_listener_ids(db, user.id) | own_listener_ids(db, user.id)
    listener = _pick_available_listener(db, category, blocked_ids, community=user.community_slug)
    if listener is None:
        # Self-heal before giving up. Prod finding (2026-09-06): every slot was held
        # by abandoned chats older than conversation_max_age_hours, and the sweep
        # only ran when an admin pressed Reconcile — so a member was told "all our
        # mentors are with someone" for a day.
        reconcile_listener_capacity(db)
        db.commit()
        # Retry once, whatever the sweep reported: while ANOTHER member's heal held
        # the listener rows, our SKIP LOCKED pick saw nobody — and their sweep, not
        # ours, is the one that freed the slot. A genuinely full pool still 503s.
        listener = _pick_available_listener(
            db, category, blocked_ids, community=user.community_slug
        )
    if listener is None:
        raise NoListenerAvailable()
    return open_conversation(db, user.id, listener, issue_category=category)


def _pending_request(
    db: Session, request_id: str, acting_listener_id: str | None
) -> ConversationRequest:
    """Load the request UNDER A ROW LOCK and re-check it is still pending.

    Without the lock two concurrent accepts (a double tap, or the admin stand-in
    racing the mentor) both read `pending`; they then serialise on the listener row,
    and the loser — still holding its stale copy — opened a second conversation and
    took a second slot for the same request. Lock order everywhere: request →
    listener. `populate_existing` defeats a stale copy in the identity map."""
    req = db.execute(
        select(ConversationRequest)
        .where(ConversationRequest.id == request_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
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
    """Accept a Personal request under row locks so neither the request nor the
    listener's capacity can be double-spent. Shared by the admin stand-in and the
    listener console."""
    req = _pending_request(db, request_id, acting_listener_id)

    # The member blocked this mentor after asking (T&S #9): the mentor must not come
    # back into their chats through the old request. Close it; opaque to the caller.
    if req.target_listener_id in blocked_listener_ids(db, req.requester_id):
        req.status = RequestStatus.declined
        db.commit()
        raise RequestNotPending()

    listener = db.execute(
        select(ListenerProfile)
        .where(ListenerProfile.id == req.target_listener_id)
        .with_for_update()
    ).scalar_one_or_none()
    # The console's own dependency refuses a suspended mentor, but the admin stand-in
    # reaches this path without it — never hand a member to an unapproved listener.
    if listener is None or listener.vetting_status != VettingStatus.approved:
        db.rollback()
        raise RequestNotPending()
    if listener.active_conversations >= listener.max_concurrent:
        db.rollback()
        raise ListenerAtCapacity()

    def _mark_matched(convo: Conversation) -> None:
        # Same transaction as the capacity reservation — request state and slot
        # can never disagree.
        req.status = RequestStatus.matched
        req.conversation_id = convo.id

    def _revert_request() -> None:
        req.status = RequestStatus.pending
        req.conversation_id = None

    convo = open_conversation(
        db,
        req.requester_id,
        listener,
        issue_category=req.issue_category,
        before_commit=_mark_matched,
        on_stream_failure=_revert_request,
    )

    # The question the member asked opens the thread, in their own words. Best-effort: the
    # conversation is already open and the mentor already said yes — a Stream hiccup here
    # must not undo that, and the mentor still has the question on the request card.
    if req.intro_message and convo.stream_channel_id:
        try:
            stream.post_message(convo.stream_channel_id, req.requester_id, req.intro_message)
        except Exception:
            logger.warning(
                "could not post the held question into %s", convo.stream_channel_id, exc_info=True
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
       `conversation_max_age_hours` (abandoned chats — except one the mentor
       snoozed, while its window is open), and any active conversation
       that still has no Stream channel after ORPHAN_GRACE (a crash between
       open_conversation's phases), is marked ended.
    2. Recompute every listener's `active_conversations` from the actual count of
       active Conversation rows — one atomic UPDATE with a correlated subquery, so
       a hand-drifted counter can't survive.

    3. Sweep stale presence (see sweep_stale_presence) — a listener whose native
       console stopped heartbeating over 15 minutes ago is marked away.

    Returns counts for the admin console: {"stale_ended": n, "listeners_corrected": n,
    "presence_swept": n}.
    """
    # Take the listener rows we can get WITHOUT waiting (id order, SKIP LOCKED) and
    # heal only those. Why lock at all: the recount below is
    # `SET active = (SELECT count…)`; under READ COMMITTED an UPDATE that has to wait
    # on a matcher's row lock re-checks the row but keeps the sub-select's ORIGINAL
    # snapshot, so the conversation that matcher just committed was not counted and
    # the counter landed one low (over-assignment). Holding the row first means the
    # recount's snapshot is taken when no reservation on it can be in flight.
    # Why SKIP LOCKED: this runs inline from match_general, and the matcher never
    # blocks on another transaction. A row a matcher holds right now is being kept
    # correct by that matcher; it is healed on the next pass.
    held = list(
        db.execute(
            select(ListenerProfile.id)
            .order_by(ListenerProfile.id)
            .with_for_update(skip_locked=True)
        ).scalars()
    )
    listener_exists = (
        select(ListenerProfile.id)
        .where(ListenerProfile.id == Conversation.listener_id)
        .correlate(Conversation)
        .exists()
    )

    now = datetime.now(UTC)
    cutoff = now - timedelta(hours=get_settings().conversation_max_age_hours)
    stale = db.execute(
        update(Conversation)
        .where(
            Conversation.status == ConversationStatus.active,
            # Only chats whose listener we hold (sweep + recount stay one unit per
            # listener) — or whose listener row no longer exists at all.
            or_(Conversation.listener_id.in_(held), ~listener_exists),
            or_(
                # Abandoned by age — unless the mentor snoozed it and the window is
                # still open ("I can't reply today" must not end the chat under them).
                and_(
                    Conversation.created_at < cutoff,
                    or_(Conversation.snoozed_until.is_(None), Conversation.snoozed_until <= now),
                ),
                # A crash between open_conversation's phases: the reservation was
                # committed but the Stream channel never arrived. Nobody can talk in
                # it; don't let it hold a slot for a day. The grace period keeps a
                # match that is mid-flight right now (Stream budget: seconds) safe.
                and_(
                    Conversation.stream_channel_id.is_(None),
                    Conversation.created_at < now - ORPHAN_GRACE,
                ),
            ),
        )
        .values(
            status=ConversationStatus.ended,
            ended_at=now,
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
        .where(
            ListenerProfile.id.in_(held),
            ListenerProfile.active_conversations != active_count,
        )
        .values(active_conversations=active_count)
    )
    swept = sweep_stale_presence(db)
    return {
        "stale_ended": stale.rowcount,
        "listeners_corrected": corrected.rowcount,
        "presence_swept": swept,
    }
