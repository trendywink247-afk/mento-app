"""My Chats backing endpoints: owner-scoped list + the verify-pin open gate."""
from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_session_token

from .conftest import TestSession, requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


def _seed_user(s, name="Quiet Cove") -> str:
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _seed_listener(s) -> str:
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _seed_convo(s, uid, lid, status=ConversationStatus.active) -> str:
    # Channel ids are unique in production (uuid-minted) and unique-indexed since
    # migration c7a91f4d2b58 — seed them unique too.
    c = Conversation(
        type="anon",
        status=status,
        user_id=uid,
        listener_id=lid,
        stream_channel_id=f"ch-{uuid.uuid4().hex[:8]}",
    )
    s.add(c)
    s.flush()
    return c.id


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


@requires_postgres
def test_list_returns_only_own_conversations_newest_first(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        other = _seed_user(s, "Other Person")
        lid = _seed_listener(s)
        _seed_convo(s, uid, lid, ConversationStatus.ended)
        _seed_convo(s, uid, lid)
        _seed_convo(s, other, lid)
        s.commit()

    r = client.get("/api/v1/conversations", headers=_auth(uid))
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 2
    assert rows[0]["listener_persona_name"] == "Open River"
    assert {row["status"] for row in rows} == {"active", "ended"}


@requires_postgres
def test_verify_pin_gates_without_unlocking(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        cid = _seed_convo(s, uid, lid)
        s.commit()

    client.post(f"/api/v1/conversations/{cid}/lock", json={"pin": "4321"}, headers=_auth(uid))

    wrong = client.post(f"/api/v1/conversations/{cid}/verify-pin", json={"pin": "1111"}, headers=_auth(uid))
    assert wrong.status_code == 403
    right = client.post(f"/api/v1/conversations/{cid}/verify-pin", json={"pin": "4321"}, headers=_auth(uid))
    assert right.status_code == 200

    # Still locked afterwards — verify is a gate, not an unlock.
    rows = client.get("/api/v1/conversations", headers=_auth(uid)).json()
    assert rows[0]["is_locked"] is True
