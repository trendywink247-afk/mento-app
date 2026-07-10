"""Minimal listener console (DECISIONS §I.6): auth scoping, revocation, presence
gating, conversation/request scoping, accept lifecycle + capacity under concurrency."""
from __future__ import annotations

import threading
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_listener_token, issue_session_token
from app.services import matching, stream

from .conftest import TestSession, requires_postgres


@pytest.fixture(autouse=True)
def _stream_stub(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )


@pytest.fixture
def client():
    return TestClient(app)


def _seed_user(s, name="Quiet Cove") -> str:
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _seed_listener(s, *, name="Open River", vetting=VettingStatus.approved, cap=3) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="river",
        categories=["loneliness"],
        status=ListenerStatus.online,
        vetting_status=vetting,
        rank=10,
        active_conversations=0,
        max_concurrent=cap,
    )
    s.add(li)
    s.flush()
    return li.id


def _user_auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def _listener_auth(listener_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_listener_token(listener_id)}"}


def _request(client, uid: str, lid: str, msg="hello") -> str:
    r = client.post(
        f"/api/v1/listeners/{lid}/request", json={"intro_message": msg}, headers=_user_auth(uid)
    )
    assert r.status_code == 200
    return r.json()["id"]


@requires_postgres
def test_roles_are_mutually_rejected(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        s.commit()

    # Listener token on a user endpoint → 401; user token on the console → 401.
    assert client.get("/api/v1/conversations", headers=_listener_auth(lid)).status_code == 401
    assert client.get("/api/v1/listener/me", headers=_user_auth(uid)).status_code == 401
    # Legacy role-less user tokens keep working on user endpoints.
    assert client.get("/api/v1/conversations", headers=_user_auth(uid)).status_code == 200


@requires_postgres
def test_suspension_revokes_console_access(client, db_session):
    with TestSession() as s:
        lid = _seed_listener(s)
        s.commit()

    headers = _listener_auth(lid)
    assert client.get("/api/v1/listener/me", headers=headers).status_code == 200

    with TestSession() as s:
        s.get(ListenerProfile, lid).vetting_status = VettingStatus.suspended
        s.commit()

    # The very same (still-valid) token is now useless.
    assert client.get("/api/v1/listener/me", headers=headers).status_code == 403


@requires_postgres
def test_me_and_status_toggle_gates_matching(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        s.commit()

    me = client.get("/api/v1/listener/me", headers=_listener_auth(lid)).json()
    assert me["persona_name"] == "Open River" and me["stream_token"]

    away = client.patch(
        "/api/v1/listener/me/status", json={"status": "away"}, headers=_listener_auth(lid)
    )
    assert away.status_code == 200 and away.json()["status"] == "away"

    # Away = invisible to General matching (503 per the match router's no-listener path).
    r = client.post("/api/v1/match", json={"kind": "general"}, headers=_user_auth(uid))
    assert r.status_code == 503

    client.patch(
        "/api/v1/listener/me/status", json={"status": "online"}, headers=_listener_auth(lid)
    )
    r = client.post("/api/v1/match", json={"kind": "general"}, headers=_user_auth(uid))
    assert r.status_code == 200


@requires_postgres
def test_conversation_scoping_and_member_persona(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s, name="Misty Vale")
        lid_a = _seed_listener(s, name="Open River")
        lid_b = _seed_listener(s, name="Calm Grove")
        s.add(
            Conversation(user_id=uid, listener_id=lid_a, status=ConversationStatus.active)
        )
        s.add(
            Conversation(user_id=uid, listener_id=lid_a, status=ConversationStatus.ended)
        )
        s.add(
            Conversation(user_id=uid, listener_id=lid_b, status=ConversationStatus.active)
        )
        s.commit()

    rows_a = client.get(
        "/api/v1/listener/me/conversations", headers=_listener_auth(lid_a)
    ).json()
    rows_b = client.get(
        "/api/v1/listener/me/conversations", headers=_listener_auth(lid_b)
    ).json()
    assert len(rows_a) == 2 and len(rows_b) == 1
    assert [r["status"] for r in rows_a] == ["active", "ended"]  # active first
    assert rows_a[0]["user_persona_name"] == "Misty Vale"


@requires_postgres
def test_request_scoping_accept_decline_and_capacity(client, db_session):
    with TestSession() as s:
        uid1 = _seed_user(s, name="Misty Vale")
        uid2 = _seed_user(s, name="Still Pond")
        lid = _seed_listener(s, cap=1)
        other = _seed_listener(s, name="Calm Grove")
        s.commit()

    req1 = _request(client, uid1, lid, "one")
    req2 = _request(client, uid2, lid, "two")
    other_req = _request(client, uid1, other, "for the other listener")

    inbox = client.get("/api/v1/listener/me/requests", headers=_listener_auth(lid)).json()
    assert [r["id"] for r in inbox] == [req1, req2]  # own pending only, oldest first
    assert inbox[0]["requester_persona_name"] == "Misty Vale"

    # Another listener's request is an opaque 404.
    not_mine = client.post(
        f"/api/v1/listener/me/requests/{other_req}/accept", headers=_listener_auth(lid)
    )
    assert not_mine.status_code == 404

    accepted = client.post(
        f"/api/v1/listener/me/requests/{req1}/accept", headers=_listener_auth(lid)
    )
    assert accepted.status_code == 200 and accepted.json()["status"] == "matched"
    # The member sees the conversation.
    convos = client.get("/api/v1/conversations", headers=_user_auth(uid1)).json()
    assert convos[0]["id"] == accepted.json()["conversation_id"]

    # Capacity 1 is now full → 409 on the second accept.
    full = client.post(
        f"/api/v1/listener/me/requests/{req2}/accept", headers=_listener_auth(lid)
    )
    assert full.status_code == 409

    declined = client.post(
        f"/api/v1/listener/me/requests/{req2}/decline", headers=_listener_auth(lid)
    )
    assert declined.status_code == 200
    mine = client.get("/api/v1/listeners/requests/mine", headers=_user_auth(uid2)).json()
    assert mine[0]["status"] == "declined"

    # Admin stand-in keeps working through the shared service (regression).
    assert not client.get("/api/v1/listener/me/requests", headers=_listener_auth(lid)).json()


@requires_postgres
def test_concurrent_accepts_cannot_double_assign(client, db_session):
    """Capacity-1 listener, two pending requests, threads racing the accept path:
    exactly one conversation may open (same row-lock guarantee as General matching)."""
    with TestSession() as s:
        uid1 = _seed_user(s, name="Misty Vale")
        uid2 = _seed_user(s, name="Still Pond")
        lid = _seed_listener(s, cap=1)
        s.commit()

    req_ids = [_request(client, uid1, lid, "a"), _request(client, uid2, lid, "b")]

    results: list[str] = []
    barrier = threading.Barrier(len(req_ids))

    def worker(req_id: str) -> None:
        session = TestSession()
        try:
            barrier.wait()
            matching.accept_personal_request(session, req_id, acting_listener_id=lid)
            results.append("matched")
        except matching.ListenerAtCapacity:
            session.rollback()
            results.append("capacity")
        finally:
            session.close()

    threads = [threading.Thread(target=worker, args=(rid,)) for rid in req_ids]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert sorted(results) == ["capacity", "matched"]
    with TestSession() as s:
        li = s.get(ListenerProfile, lid)
        assert li.active_conversations == 1
        convos = s.query(Conversation).filter(Conversation.listener_id == lid).all()
        assert len(convos) == 1
