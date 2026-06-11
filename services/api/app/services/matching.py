"""Listener matching. General → next-available; Personal → directed (deferred accept)."""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    ConversationType,
    ListenerStatus,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.moderation import ModerationEvent
from app.models.user import User
from app.services import stream


class NoListenerAvailable(Exception):
    """No approved, online listener has spare capacity right now."""


def _blocked_listener_ids(db: Session, user_id: str) -> set[str]:
    """Listeners this user has blocked — never re-match them (Trust & Safety #9)."""
    rows = db.execute(
        select(ModerationEvent.subject_id).where(
            ModerationEvent.reporter_id == user_id,
            ModerationEvent.blocked.is_(True),
        )
    ).scalars().all()
    return set(rows)


def _pick_available_listener(
    db: Session, category: str | None, blocked_ids: set[str]
) -> ListenerProfile | None:
    """Lowest current load, then highest rank. Row-locked to avoid double-assignment.

    Pulls a small locked candidate set and prefers a category match in Python (portable
    across JSON/JSONB); falls back to the best available listener if none matches.
    Listeners the user has blocked are excluded.
    """
    candidates = (
        db.execute(
            select(ListenerProfile)
            .where(
                ListenerProfile.vetting_status == VettingStatus.approved,
                ListenerProfile.status == ListenerStatus.online,
                ListenerProfile.active_conversations < ListenerProfile.max_concurrent,
            )
            .order_by(ListenerProfile.active_conversations.asc(), ListenerProfile.rank.desc())
            .limit(10)
            .with_for_update(skip_locked=True)
        )
        .scalars()
        .all()
    )
    candidates = [c for c in candidates if c.id not in blocked_ids]
    if not candidates:
        return None
    if category:
        for listener in candidates:
            if category in (listener.categories or []):
                return listener
    return candidates[0]


def open_conversation(db: Session, user_id: str, listener: ListenerProfile) -> Conversation:
    """Open a conversation + Stream channel with a specific listener (capacity already
    reserved by the caller under a row lock). Shared by general match and personal
    request acceptance."""
    listener.active_conversations += 1

    convo = Conversation(
        type=ConversationType.anon,
        status=ConversationStatus.active,
        user_id=user_id,
        listener_id=listener.id,
    )
    db.add(convo)
    db.flush()  # assign convo.id

    channel_id = stream.create_dm_channel(
        channel_id=f"c-{uuid.uuid4().hex[:20]}",
        user_id=user_id,
        listener_id=listener.id,
    )
    convo.stream_channel_id = channel_id
    db.commit()
    db.refresh(convo)
    return convo


def match_general(db: Session, user: User, category: str | None = None) -> Conversation:
    """Match the user to the next available listener and open a Stream channel."""
    blocked_ids = _blocked_listener_ids(db, user.id)
    listener = _pick_available_listener(db, category, blocked_ids)
    if listener is None:
        raise NoListenerAvailable()
    return open_conversation(db, user.id, listener)
