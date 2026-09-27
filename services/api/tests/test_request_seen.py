"""The letter's Seen / Replying are real (board A04, founder review 2026-09-20).

`seen_at` is stamped the first time a question appears in the mentor's OWN console inbox,
never by anyone else's read and never moved afterwards; `replying` is their yes.

Since T2.3 the inbox GET only reads; the console stamps what it showed with
POST /listener/me/requests/seen (`_open_inbox` below does both, like the app).
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.enums import ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_listener_token, issue_session_token
from app.services import stream

from .conftest import TestSession


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


def _seed_listener(s, name="Open River") -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="river",
        categories=["loneliness"],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _user_auth(uid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _listener_auth(lid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_listener_token(lid)}"}


def _ask(client: TestClient, uid: str, lid: str, text: str = "can we talk about mocks") -> dict:
    res = client.post(
        f"/api/v1/listeners/{lid}/request",
        headers=_user_auth(uid),
        json={"intro_message": text},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _open_inbox(client: TestClient, lid: str) -> list[dict]:
    """What the console does: read the inbox, then mark what it showed as seen."""
    rows = client.get("/api/v1/listener/me/requests", headers=_listener_auth(lid)).json()
    res = client.post(
        "/api/v1/listener/me/requests/seen",
        headers=_listener_auth(lid),
        json={"request_ids": [r["id"] for r in rows]},
    )
    assert res.status_code == 200, res.text
    return rows


def _mine(client: TestClient, uid: str, request_id: str) -> dict:
    rows = client.get("/api/v1/listeners/requests/mine", headers=_user_auth(uid)).json()
    return next(r for r in rows if r["id"] == request_id)


def test_seen_is_stamped_only_when_the_asked_mentor_opens_their_inbox(client):
    with TestSession() as s:
        uid = _seed_user(s)
        asked = _seed_listener(s)
        someone_else = _seed_listener(s, name="Calm Grove")
        s.commit()

    sent = _ask(client, uid, asked)
    assert sent["seen_at"] is None and sent["replying"] is False
    assert _mine(client, uid, sent["id"])["seen_at"] is None

    # Another mentor's inbox read must not mark this question seen.
    assert _open_inbox(client, someone_else) == []
    assert _mine(client, uid, sent["id"])["seen_at"] is None

    # Reading alone never stamps (a GET has no side effects since T2.3).
    client.get("/api/v1/listener/me/requests", headers=_listener_auth(asked))
    assert _mine(client, uid, sent["id"])["seen_at"] is None
    # Nor can another mentor stamp it by naming its id.
    client.post(
        "/api/v1/listener/me/requests/seen",
        headers=_listener_auth(someone_else),
        json={"request_ids": [sent["id"]]},
    )
    assert _mine(client, uid, sent["id"])["seen_at"] is None
    inbox = _open_inbox(client, asked)
    assert [r["id"] for r in inbox] == [sent["id"]]
    first = _mine(client, uid, sent["id"])["seen_at"]
    assert first is not None

    # Seen happened once: a second read never moves it.
    _open_inbox(client, asked)
    assert _mine(client, uid, sent["id"])["seen_at"] == first


def test_replying_is_the_mentors_yes(client):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        s.commit()

    sent = _ask(client, uid, lid)
    _open_inbox(client, lid)
    seen = _mine(client, uid, sent["id"])
    assert seen["seen_at"] is not None and seen["replying"] is False

    accepted = client.post(
        f"/api/v1/listener/me/requests/{sent['id']}/accept", headers=_listener_auth(lid)
    )
    assert accepted.status_code == 200
    assert accepted.json()["replying"] is True

    after = _mine(client, uid, sent["id"])
    assert after["replying"] is True and after["seen_at"] == seen["seen_at"]


def test_a_declined_question_keeps_its_seen_and_never_says_replying(client):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        s.commit()

    sent = _ask(client, uid, lid)
    _open_inbox(client, lid)
    client.post(f"/api/v1/listener/me/requests/{sent['id']}/decline", headers=_listener_auth(lid))

    row = _mine(client, uid, sent["id"])
    assert row["status"] == "declined"
    assert row["seen_at"] is not None
    assert row["replying"] is False
