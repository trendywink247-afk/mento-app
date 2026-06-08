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
from app.models.user import User
from app.services import stream


class NoListenerAvailable(Exception):
    """No approved, online listener has spare capacity right now."""


def _pick_available_listener(db: Session, category: str | None) -> ListenerProfile | None:
    """Lowest current load, then highest rank. Row-locked to avoid double-assignment.

    Pulls a small locked candidate set and prefers a category match in Python (portable
    across JSON/JSONB); falls back to the best available listener if none matches.
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
    if not candidates:
        return None
    if category:
        for listener in candidates:
            if category in (listener.categories or []):
                return listener
    return candidates[0]


def match_general(db: Session, user: User, category: str | None = None) -> Conversation:
    """Match the user to the next available listener and open a Stream channel."""
    listener = _pick_available_listener(db, category)
    if listener is None:
        raise NoListenerAvailable()

    listener.active_conversations += 1

    convo = Conversation(
        type=ConversationType.anon,
        status=ConversationStatus.active,
        user_id=user.id,
        listener_id=listener.id,
    )
    db.add(convo)
    db.flush()  # assign convo.id

    channel_id = stream.create_dm_channel(
        channel_id=f"c-{uuid.uuid4().hex[:20]}",
        user_id=user.id,
        listener_id=listener.id,
    )
    convo.stream_channel_id = channel_id
    db.commit()
    db.refresh(convo)
    return convo
