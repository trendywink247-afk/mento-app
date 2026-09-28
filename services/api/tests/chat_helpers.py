"""Shared seeding for the own-chat tests (tests/test_chat_*.py)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_listener_token, issue_session_token


@dataclass
class SeededChat:
    cid: str
    member_id: str
    mentor_id: str
    member: str  # bearer token
    mentor: str  # bearer token

    def __getitem__(self, key: str) -> str:  # the spike's tests index it like a dict
        return getattr(self, key)


def seed_chat(s) -> SeededChat:
    """A member, a mentor and an active conversation between them, committed on `s`.
    The conversation's channel key is its own id, as own-chat conversations have."""
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=1,
        max_concurrent=3,
    )
    s.add_all([u, li])
    s.flush()
    c = Conversation(type="anon", status=ConversationStatus.active, user_id=u.id, listener_id=li.id)
    s.add(c)
    s.flush()
    c.stream_channel_id = c.id
    s.commit()
    return SeededChat(
        cid=c.id,
        member_id=u.id,
        mentor_id=li.id,
        member=issue_session_token(u.id),
        mentor=issue_listener_token(li.id),
    )
