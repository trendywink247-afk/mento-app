"""Listener capacity accounting: release is idempotent and race-safe, and the admin
reconcile action heals both counter drift and leaked slots from stale conversations.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.admin import AdminAccount
from app.models.conversation import Conversation
from app.models.enums import AdminRole, ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_admin_token, issue_session_token
from app.services import stream

from .conftest import TestSession, requires_postgres


@pytest.fixture(autouse=True)
def _stub_stream(monkeypatch):
    """Hermetic: no live Stream calls even with creds present."""
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )
    monkeypatch.setattr(stream, "wipe_channel", lambda channel_id: None)


@pytest.fixture
def client():
    return TestClient(app)


def _seed_user(s) -> str:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _seed_listener(s, *, active=0, max_concurrent=3) -> str:
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=active,
        max_concurrent=max_concurrent,
    )
    s.add(li)
    s.flush()
    return li.id


def _seed_active_convo(s, user_id: str, listener_id: str, *, created_at=None) -> str:
    c = Conversation(
        type="anon",
        status=ConversationStatus.active,
        user_id=user_id,
        listener_id=listener_id,
        stream_channel_id=None,
    )
    if created_at is not None:
        c.created_at = created_at
    s.add(c)
    s.flush()
    return c.id


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def _admin_auth(s) -> dict:
    a = AdminAccount(name="Founder", role=AdminRole.owner)
    s.add(a)
    s.flush()
    return {"Authorization": f"Bearer {issue_admin_token(a.id)}"}


@requires_postgres
def test_end_twice_decrements_once(client, db_session):
    # Listener has 2 slots in use; ending ONE conversation twice must free ONE slot.
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s, active=2)
        cid = _seed_active_convo(s, uid, lid)
        s.commit()

    first = client.post(f"/api/v1/conversations/{cid}/end", headers=_auth(uid))
    assert first.status_code == 200
    second = client.post(f"/api/v1/conversations/{cid}/end", headers=_auth(uid))
    assert second.status_code == 200

    with TestSession() as s:
        assert s.get(ListenerProfile, lid).active_conversations == 1

    # Wiping the already-ended chat still wipes but must NOT release another slot.
    wiped = client.post(f"/api/v1/conversations/{cid}/wipe", headers=_auth(uid))
    assert wiped.status_code == 200
    with TestSession() as s:
        assert s.get(Conversation, cid).status == ConversationStatus.wiped
        assert s.get(ListenerProfile, lid).active_conversations == 1


@requires_postgres
def test_reconcile_fixes_drifted_counter(client, db_session):
    # Counter says 3, reality is 1 active conversation — reconcile snaps it back.
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s, active=3)
        _seed_active_convo(s, uid, lid)
        admin_h = _admin_auth(s)
        s.commit()

    r = client.post("/api/v1/admin/listeners/reconcile", headers=admin_h)
    assert r.status_code == 200
    body = r.json()
    assert body["stale_ended"] == 0
    assert body["listeners_corrected"] == 1

    with TestSession() as s:
        assert s.get(ListenerProfile, lid).active_conversations == 1


@requires_postgres
def test_reconcile_ends_stale_conversations_and_frees_slots(client, db_session):
    # An abandoned chat older than conversation_max_age_hours leaks a slot until
    # reconcile ends it and recomputes the counter to 0.
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s, active=1)
        stale_created = datetime.now(UTC) - timedelta(hours=25)
        cid = _seed_active_convo(s, uid, lid, created_at=stale_created)
        admin_h = _admin_auth(s)
        s.commit()

    r = client.post("/api/v1/admin/listeners/reconcile", headers=admin_h)
    assert r.status_code == 200
    body = r.json()
    assert body["stale_ended"] == 1
    assert body["listeners_corrected"] == 1

    with TestSession() as s:
        convo = s.get(Conversation, cid)
        assert convo.status == ConversationStatus.ended
        assert convo.ended_at is not None
        assert s.get(ListenerProfile, lid).active_conversations == 0

    # A fresh active conversation is NOT swept.
    with TestSession() as s:
        uid2 = _seed_user(s)
        cid2 = _seed_active_convo(s, uid2, lid)
        s.commit()
    again = client.post("/api/v1/admin/listeners/reconcile", headers=admin_h)
    assert again.json()["stale_ended"] == 0
    with TestSession() as s:
        assert s.get(Conversation, cid2).status == ConversationStatus.active
        assert s.get(ListenerProfile, lid).active_conversations == 1
