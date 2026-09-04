"""Native mentor console (spec 2026-09-05): console-session issuance, presence
heartbeat + sweep, mentor-side report/end scoping, ended_by stamping."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import (
    ApplicationStatus,
    ConversationEndedBy,
    ConversationStatus,
    ListenerStatus,
    ReporterKind,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.moderation import ModerationEvent
from app.models.user import User
from app.security import issue_listener_token, issue_session_token
from app.services import matching, stream

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture(autouse=True)
def _stream_stub(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )
    monkeypatch.setattr(stream, "user_token", lambda uid: f"stream-{uid}")


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, listener_applications, conversations, "
                "conversation_requests, moderation_events CASCADE"
            )
        )
        s.commit()
    yield


@pytest.fixture
def client():
    return TestClient(app)


def _user(s, name="Quiet Cove") -> str:
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _listener(s, *, vetting=VettingStatus.approved, status=ListenerStatus.online, seen=None) -> str:
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=["loneliness"],
        status=status,
        vetting_status=vetting,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
        last_seen_at=seen,
    )
    s.add(li)
    s.flush()
    return li.id


def _convo(s, user_id: str, listener_id: str) -> str:
    li = s.get(ListenerProfile, listener_id)
    li.active_conversations += 1
    c = Conversation(
        user_id=user_id, listener_id=listener_id, stream_channel_id=f"ch-{user_id[:8]}"
    )
    s.add(c)
    s.flush()
    return c.id


def member_auth(user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def listener_auth(listener_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_listener_token(listener_id)}"}


# --- ended_by on the member paths ---------------------------------------------


def test_member_end_stamps_ended_by_and_releases_slot(client):
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        cid = _convo(s, uid, lid)
        s.commit()
    r = client.post(f"/api/v1/conversations/{cid}/end", headers=member_auth(uid))
    assert r.status_code == 200, r.text
    with TestSession() as s:
        c = s.get(Conversation, cid)
        assert c.status == ConversationStatus.ended
        assert c.ended_by == ConversationEndedBy.member
        assert s.get(ListenerProfile, lid).active_conversations == 0
