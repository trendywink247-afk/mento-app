"""Listener discovery + Personal request lifecycle (request → accept/decline)."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.admin import AdminAccount
from app.models.enums import AdminRole, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_admin_token, issue_session_token
from app.services import stream

from .conftest import TestSession, requires_postgres


@pytest.fixture(autouse=True)
def _stream_stub(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )


@pytest.fixture
def client():
    return TestClient(app)


def _seed_user(s) -> str:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _seed_admin(s) -> str:
    a = AdminAccount(name="Founder", role=AdminRole.owner)
    s.add(a)
    s.flush()
    return a.id


def _admin_auth(admin_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_admin_token(admin_id)}"}


def _seed_listener(s, *, name="Open River", vetting=VettingStatus.approved, online=True) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="river",
        categories=["loneliness"],
        status=ListenerStatus.online if online else ListenerStatus.offline,
        vetting_status=vetting,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


@requires_postgres
def test_list_shows_only_approved_with_availability(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        _seed_listener(s, name="Open River")
        _seed_listener(s, name="Quiet Hill", online=False)
        _seed_listener(s, name="Pending Person", vetting=VettingStatus.pending)
        s.commit()

    rows = client.get("/api/v1/listeners", headers=_auth(uid)).json()
    assert [r["persona_name"] for r in rows] == ["Open River", "Quiet Hill"]
    assert rows[0]["available"] is True and rows[1]["available"] is False


@requires_postgres
def test_personal_request_lifecycle_accept(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        aid = _seed_admin(s)
        s.commit()

    r = client.post(
        f"/api/v1/listeners/{lid}/request",
        json={"intro_message": "I could use someone who understands loneliness."},
        headers=_auth(uid),
    )
    assert r.status_code == 200 and r.json()["status"] == "pending"
    req_id = r.json()["id"]

    # A second identical request reuses the pending one.
    again = client.post(
        f"/api/v1/listeners/{lid}/request",
        json={"intro_message": "hello again"},
        headers=_auth(uid),
    )
    assert again.json()["id"] == req_id

    accepted = client.post(
        f"/api/v1/listeners/requests/{req_id}/accept", headers=_admin_auth(aid)
    )
    assert accepted.status_code == 200
    assert accepted.json()["status"] == "matched"
    assert accepted.json()["conversation_id"]

    # The user sees the matched conversation in their lists.
    mine = client.get("/api/v1/listeners/requests/mine", headers=_auth(uid)).json()
    assert mine[0]["status"] == "matched"
    convos = client.get("/api/v1/conversations", headers=_auth(uid)).json()
    assert convos[0]["id"] == accepted.json()["conversation_id"]


@requires_postgres
def test_personal_request_decline_and_admin_guard(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        aid = _seed_admin(s)
        s.commit()

    req = client.post(
        f"/api/v1/listeners/{lid}/request",
        json={"intro_message": "hi"},
        headers=_auth(uid),
    ).json()

    # No admin session → unauthorized; a user token must not cross roles.
    assert client.post(f"/api/v1/listeners/requests/{req['id']}/accept").status_code in (401, 403)
    assert (
        client.post(
            f"/api/v1/listeners/requests/{req['id']}/accept", headers=_auth(uid)
        ).status_code
        == 401
    )

    declined = client.post(
        f"/api/v1/listeners/requests/{req['id']}/decline", headers=_admin_auth(aid)
    )
    assert declined.status_code == 200
    mine = client.get("/api/v1/listeners/requests/mine", headers=_auth(uid)).json()
    assert mine[0]["status"] == "declined"
