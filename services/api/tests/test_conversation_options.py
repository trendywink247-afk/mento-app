"""Conversation Options sheet — backend flows, with focus on the safety-adjacent ones:
block prevents re-match, and report files a human-reviewable moderation event.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models.admin import AdminAccount
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.moderation import ModerationEvent
from app.models.user import User
from app.security import issue_admin_token, issue_session_token
from app.services import stream
from app.services.matching import NoListenerAvailable, match_general

from .conftest import TestSession, requires_postgres


@pytest.fixture(autouse=True)
def _stub_stream(monkeypatch):
    """Keep these tests hermetic (no live Stream calls) even with creds present."""
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


def _seed_listener(s, *, online=True) -> str:
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=[],
        status=ListenerStatus.online if online else ListenerStatus.offline,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _seed_active_convo(s, user_id: str, listener_id: str) -> str:
    c = Conversation(
        type="anon",
        status=ConversationStatus.active,
        user_id=user_id,
        listener_id=listener_id,
        stream_channel_id=None,
    )
    s.add(c)
    s.flush()
    return c.id


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


@requires_postgres
def test_lock_requires_correct_pin_to_unlock(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        cid = _seed_active_convo(s, uid, lid)
        s.commit()

    r = client.post(f"/api/v1/conversations/{cid}/lock", json={"pin": "1234"}, headers=_auth(uid))
    assert r.status_code == 200 and r.json()["is_locked"] is True

    # Wrong PIN is rejected; the chat stays locked.
    bad = client.post(
        f"/api/v1/conversations/{cid}/unlock", json={"pin": "9999"}, headers=_auth(uid)
    )
    assert bad.status_code == 403

    ok = client.post(
        f"/api/v1/conversations/{cid}/unlock", json={"pin": "1234"}, headers=_auth(uid)
    )
    assert ok.status_code == 200 and ok.json()["is_locked"] is False

    # PIN is hashed, never stored raw.
    with TestSession() as s:
        convo = s.get(Conversation, cid)
        assert convo.pin_hash and convo.pin_hash != "1234"


@requires_postgres
def test_status_mask_and_pause(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        cid = _seed_active_convo(s, uid, _seed_listener(s))
        s.commit()
    assert (
        client.post(
            f"/api/v1/conversations/{cid}/status-mask", json={"mask": "Away"}, headers=_auth(uid)
        ).json()["status_mask"]
        == "Away"
    )
    assert (
        client.post(
            f"/api/v1/conversations/{cid}/pause", json={"paused": True}, headers=_auth(uid)
        ).json()["is_paused"]
        is True
    )


@requires_postgres
def test_report_ends_chat_and_lands_in_review_queue(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        cid = _seed_active_convo(s, uid, lid)
        s.commit()

    r = client.post(
        f"/api/v1/conversations/{cid}/report",
        json={"reason": "made me uncomfortable"},
        headers=_auth(uid),
    )
    assert r.status_code == 200 and r.json()["status"] == "reported"

    # Chat is ended, and an UNREVIEWED moderation event exists (surfaced, not just stored).
    with TestSession() as s:
        convo = s.get(Conversation, cid)
        assert convo.status == ConversationStatus.ended
        ev = s.execute(
            select(ModerationEvent).where(ModerationEvent.conversation_id == cid)
        ).scalar_one()
        assert (
            ev.reviewed is False and ev.subject_id == lid and ev.reason == "made me uncomfortable"
        )

    # It appears in the admin console review queue (JWT-authed, audit-logged).
    with TestSession() as s:
        admin = AdminAccount(name="Reviewer")
        s.add(admin)
        s.commit()
        admin_token = issue_admin_token(admin.id)
    q = client.get(
        "/api/v1/admin/moderation/queue",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert q.status_code == 200
    assert any(item["conversation_id"] == cid and item["reviewed"] is False for item in q.json())
    item = next(i for i in q.json() if i["conversation_id"] == cid)
    assert item["reporter_kind"] == "member"
    # Queue is guarded.
    assert client.get("/api/v1/admin/moderation/queue").status_code in (401, 403)


@requires_postgres
def test_block_prevents_rematch_to_that_listener(client, db_session):
    # One eligible listener; once blocked, matching must NOT return it → none available.
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        cid = _seed_active_convo(s, uid, lid)
        s.commit()

    r = client.post(
        f"/api/v1/conversations/{cid}/block", json={"reason": "harassment"}, headers=_auth(uid)
    )
    assert r.status_code == 200 and r.json()["status"] == "blocked"

    with TestSession() as s:
        ev = s.execute(
            select(ModerationEvent).where(ModerationEvent.conversation_id == cid)
        ).scalar_one()
        assert ev.blocked is True
        assert s.get(Conversation, cid).status == ConversationStatus.ended

        # The blocked listener is the only one online → re-match finds nobody.
        user = s.get(User, uid)
        with pytest.raises(NoListenerAvailable):
            match_general(s, user)

        # Sanity: a DIFFERENT user is still matched to that same listener.
        other = User(
            persona_name="New Soul", persona_avatar="x", dob=date(1995, 1, 1), age_at_signup=31
        )
        s.add(other)
        s.flush()
        convo = match_general(s, other)
        assert convo.listener_id == lid
        assert s.execute(select(func.count()).select_from(Conversation)).scalar_one() >= 2
