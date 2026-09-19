"""The member can see their own conversation's topic (feeds the chat header chip).

Additive on two member-facing responses: the My Chats list item and
`GET /conversations/{id}/mentor`. It is the member's OWN match-time choice — and the
Browse profile (`GET /listeners/{id}`), which has no conversation, must not grow it.
"""

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


def _user(s, name="Gentle Harbor") -> str:
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _listener(s) -> str:
    li = ListenerProfile(
        persona_name="Steady Cedar",
        persona_avatar="cedar",
        categories=["family"],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _convo(s, uid: str, lid: str, topic: str | None) -> str:
    c = Conversation(
        type="anon",
        status=ConversationStatus.active,
        user_id=uid,
        listener_id=lid,
        stream_channel_id=f"ch-{uuid.uuid4().hex[:8]}",
        issue_category=topic,
    )
    s.add(c)
    s.flush()
    return c.id


def _auth(uid: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


@requires_postgres
def test_list_and_mentor_context_carry_the_topic_slug_and_label(client, db_session):
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        with_topic = _convo(s, uid, lid, "exam_stress")
        historic = _convo(s, uid, lid, None)
        free_text = _convo(s, uid, lid, "something-unlisted")
        s.commit()

    rows = {r["id"]: r for r in client.get("/api/v1/conversations", headers=_auth(uid)).json()}
    assert rows[with_topic]["issue_category"] == "exam_stress"
    assert rows[with_topic]["issue_category_label"] == "Exam stress"
    assert rows[historic]["issue_category"] is None
    assert rows[historic]["issue_category_label"] is None
    # An unlisted slug is returned as stored, with no label — the client hides the chip.
    assert rows[free_text]["issue_category"] == "something-unlisted"
    assert rows[free_text]["issue_category_label"] is None

    mentor = client.get(f"/api/v1/conversations/{with_topic}/mentor", headers=_auth(uid)).json()
    assert mentor["issue_category"] == "exam_stress"
    assert mentor["issue_category_label"] == "Exam stress"
    assert mentor["persona_name"] == "Steady Cedar"  # the existing shape is intact
    assert mentor["categories"] == ["family"]  # the MENTOR's focus, a different thing


@requires_postgres
def test_the_topic_is_only_ever_shown_to_the_member_who_chose_it(client, db_session):
    with TestSession() as s:
        owner, stranger, lid = _user(s), _user(s, "Other Shore"), _listener(s)
        cid = _convo(s, owner, lid, "family")
        s.commit()
    assert (
        client.get(f"/api/v1/conversations/{cid}/mentor", headers=_auth(stranger)).status_code
        == 404
    )
    assert client.get("/api/v1/conversations", headers=_auth(stranger)).json() == []
    # Browse has no conversation in play — its profile shape does not grow the field.
    browse = client.get(f"/api/v1/listeners/{lid}", headers=_auth(stranger)).json()
    assert "issue_category" not in browse
