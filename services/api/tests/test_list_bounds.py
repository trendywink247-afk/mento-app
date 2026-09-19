"""List endpoints are bounded, ordered in SQL, and the admin queue is not an N+1
(audit F14). All additive: new optional query params, one new count endpoint."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from app.db import engine
from app.main import app
from app.models.admin import AdminAccount
from app.models.conversation import Conversation
from app.models.enums import (
    AdminRole,
    ConversationStatus,
    JournalChannel,
    ListenerStatus,
    SafetySignal,
    VettingStatus,
)
from app.models.journal import JournalEntry
from app.models.listener import ListenerProfile
from app.models.safety import SafetyFlag
from app.models.user import User
from app.security import issue_admin_token, issue_listener_token, issue_session_token

from .conftest import TestSession, requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


def _user(s, name="Quiet Cove") -> str:
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _listener(s) -> str:
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
    s.add(li)
    s.flush()
    return li.id


def _convo(s, uid, lid, status, age_days) -> str:
    c = Conversation(
        type="anon",
        status=status,
        user_id=uid,
        listener_id=lid,
        stream_channel_id=f"ch-{uuid.uuid4().hex[:8]}",
    )
    c.created_at = datetime.now(UTC) - timedelta(days=age_days)
    s.add(c)
    s.flush()
    return c.id


@requires_postgres
def test_mentor_list_is_bounded_and_an_old_active_chat_is_never_cut(client, db_session):
    with TestSession() as s:
        lid = _listener(s)
        old_active = _convo(s, _user(s), lid, ConversationStatus.active, age_days=20)
        newer_ended = [
            _convo(s, _user(s), lid, ConversationStatus.ended, age_days=d) for d in (1, 2, 3)
        ]
        s.commit()
    headers = {"Authorization": f"Bearer {issue_listener_token(lid)}"}
    page = client.get("/api/v1/listener/me/conversations?limit=2", headers=headers).json()
    assert [row["id"] for row in page] == [old_active, newer_ended[0]]
    everything = client.get("/api/v1/listener/me/conversations", headers=headers).json()
    assert [row["id"] for row in everything] == [old_active, *newer_ended]


@requires_postgres
def test_saved_count_for_one_conversation_is_exact_past_the_page_size(client, db_session):
    with TestSession() as s:
        uid, other = _user(s), _user(s, "Other Shore")
        for i in range(205):
            s.add(
                JournalEntry(
                    user_id=uid,
                    channel=JournalChannel.mentor_notes,
                    body=f"kept {i}",
                    source="chat",
                    meta={"conversation_id": "convo-A", "stream_message_id": f"m{i}"},
                )
            )
        s.add(
            JournalEntry(
                user_id=uid,
                channel=JournalChannel.mentor_notes,
                body="from another chat",
                source="chat",
                meta={"conversation_id": "convo-B"},
            )
        )
        s.add(
            JournalEntry(
                user_id=other,
                channel=JournalChannel.mentor_notes,
                body="someone else's",
                source="chat",
                meta={"conversation_id": "convo-A"},
            )
        )
        s.commit()
    auth = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    count = client.get("/api/v1/journals/mentor-notes/count?conversation_id=convo-A", headers=auth)
    assert count.status_code == 200 and count.json() == {"count": 205}
    assert client.get("/api/v1/journals/mentor-notes/count", headers=auth).json() == {"count": 206}
    filtered = client.get(
        "/api/v1/journals/mentor-notes?conversation_id=convo-B", headers=auth
    ).json()
    assert [e["body"] for e in filtered] == ["from another chat"]


@requires_postgres
def test_admin_safety_queue_does_not_query_per_flag(client, db_session):
    with TestSession() as s:
        lid = _listener(s)
        for _ in range(25):
            uid = _user(s)
            cid = _convo(s, uid, lid, ConversationStatus.active, age_days=0)
            s.add(SafetyFlag(conversation_id=cid, user_id=uid, signal=SafetySignal.suicidal))
        admin = AdminAccount(name="Founder", role=AdminRole.owner)
        s.add(admin)
        s.commit()
        headers = {"Authorization": f"Bearer {issue_admin_token(admin.id)}"}

    statements: list[str] = []

    def _count(_conn, _cursor, statement, *_rest) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", _count)
    try:
        r = client.get("/api/v1/admin/safety/flags", headers=headers)
    finally:
        event.remove(engine, "before_cursor_execute", _count)
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 25
    assert all(row["member_persona"] and row["listener_persona"] == "Open River" for row in rows)
    assert len(statements) <= 6  # was 1 + 3 per flag (76 for this page)
