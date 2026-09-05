"""Push notifications (spec 2026-09-05): token ownership, triggers, suppression, resilience."""

from __future__ import annotations

from datetime import date, datetime, UTC

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app import ratelimit
from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, PushOwnerKind, VettingStatus
from app.models.listener import ListenerProfile
from app.models.push_token import PushToken
from app.models.request import ConversationRequest
from app.models.user import User
from app.security import issue_listener_token, issue_session_token
from app.services import push, stream

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, conversations, conversation_requests, "
                "push_tokens, safety_flags CASCADE"
            )
        )
        s.commit()
    yield


@pytest.fixture(autouse=True)
def _stream_stub(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )
    monkeypatch.setattr(stream, "user_token", lambda uid: f"stream-{uid}")


@pytest.fixture
def sent(monkeypatch):
    """Turn push ON for this test and record every Expo send instead of calling out."""
    calls: list[dict] = []

    def fake_post(messages: list[dict]) -> list[dict]:
        calls.extend(messages)
        return [{"status": "ok"} for _ in messages]

    monkeypatch.setattr(push, "ENABLED", True)
    monkeypatch.setattr(push, "_post_expo", fake_post)
    monkeypatch.setattr(push, "_is_watching", lambda channel_id, user_id: False)
    return calls


@pytest.fixture
def client():
    return TestClient(app)


def _user(s, name="Quiet Cove") -> str:
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _listener(
    s, *, name="Open River", vetting=VettingStatus.approved, status=ListenerStatus.online
) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="river",
        categories=["loneliness"],
        status=status,
        vetting_status=vetting,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _token(s, kind: PushOwnerKind, owner_id: str, value: str) -> None:
    s.add(
        PushToken(
            user_id=owner_id,
            owner_kind=kind,
            owner_id=owner_id,
            expo_push_token=value,
            platform="android",
        )
    )
    s.flush()


def _convo(s, user_id: str, listener_id: str, *, paused=False) -> str:
    c = Conversation(
        user_id=user_id,
        listener_id=listener_id,
        stream_channel_id=f"ch-{user_id[:8]}",
        is_paused=paused,
    )
    s.add(c)
    s.flush()
    return c.id


def member_auth(uid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def listener_auth(lid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_listener_token(lid)}"}


# --- ownership ------------------------------------------------------------------


def test_member_register_sets_owner_member(client):
    with TestSession() as s:
        uid = _user(s)
        s.commit()
    r = client.post(
        "/api/v1/notifications/register-token",
        json={"expo_push_token": "ExponentPushToken[m1]", "platform": "android"},
        headers=member_auth(uid),
    )
    assert r.status_code == 200
    with TestSession() as s:
        row = s.scalars(select(PushToken)).one()
        assert row.owner_kind == PushOwnerKind.member and row.owner_id == uid and row.user_id == uid


def test_listener_register_sets_owner_listener_and_repoints_a_member_token(client):
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        s.commit()
    tok = "ExponentPushToken[one-device]"
    client.post(
        "/api/v1/notifications/register-token",
        json={"expo_push_token": tok, "platform": "android"},
        headers=member_auth(uid),
    )
    r = client.post(
        "/api/v1/listener/me/push-token",
        json={"expo_push_token": tok, "platform": "android"},
        headers=listener_auth(lid),
    )
    assert r.status_code == 200 and r.json()["status"] == "registered"
    with TestSession() as s:
        rows = s.scalars(select(PushToken)).all()
        assert len(rows) == 1
        assert rows[0].owner_kind == PushOwnerKind.listener and rows[0].owner_id == lid


def test_listener_register_refused_when_suspended(client):
    with TestSession() as s:
        lid = _listener(s, vetting=VettingStatus.suspended)
        s.commit()
    r = client.post(
        "/api/v1/listener/me/push-token",
        json={"expo_push_token": "ExponentPushToken[x]", "platform": "android"},
        headers=listener_auth(lid),
    )
    assert r.status_code == 403


def test_member_delete_removes_only_own_token(client):
    with TestSession() as s:
        a, b = _user(s), _user(s, "Still Pine")
        _token(s, PushOwnerKind.member, a, "ExponentPushToken[a]")
        _token(s, PushOwnerKind.member, b, "ExponentPushToken[b]")
        s.commit()
    r = client.request(
        "DELETE",
        "/api/v1/notifications/register-token",
        json={"expo_push_token": "ExponentPushToken[b]"},
        headers=member_auth(a),
    )
    assert r.status_code == 200 and r.json()["status"] == "ok"
    r = client.request(
        "DELETE",
        "/api/v1/notifications/register-token",
        json={"expo_push_token": "ExponentPushToken[a]"},
        headers=member_auth(a),
    )
    assert r.status_code == 200
    with TestSession() as s:
        assert [t.expo_push_token for t in s.scalars(select(PushToken)).all()] == [
            "ExponentPushToken[b]"
        ]
