"""Listener capacity accounting: release is idempotent and race-safe, and the admin
reconcile action heals both counter drift and leaked slots from stale conversations.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

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


@requires_postgres
def test_match_self_heals_a_slot_leaked_by_a_stale_conversation(client, db_session):
    # The only listener is "full" purely because an abandoned chat older than
    # conversation_max_age_hours never ended. General match must sweep + retry
    # instead of 503ing (prod finding, 2026-09-06: nine day-old test chats held
    # every slot and a fresh member saw "all our mentors are with someone").
    with TestSession() as s:
        old_uid = _seed_user(s)
        lid = _seed_listener(s, active=1, max_concurrent=1)
        stale_cid = _seed_active_convo(
            s, old_uid, lid, created_at=datetime.now(UTC) - timedelta(hours=25)
        )
        new_uid = _seed_user(s)
        s.commit()

    r = client.post("/api/v1/match", json={"kind": "general"}, headers=_auth(new_uid))
    assert r.status_code == 200, r.text
    assert r.json()["listener_persona_name"] == "Open River"

    with TestSession() as s:
        stale = s.get(Conversation, stale_cid)
        assert stale.status == ConversationStatus.ended
        assert stale.ended_at is not None
        # Exactly the new chat is counted — the swept one no longer holds a slot.
        assert s.get(ListenerProfile, lid).active_conversations == 1


@requires_postgres
def test_match_still_503_when_capacity_is_genuinely_full(client, db_session):
    # A live, recent conversation is never swept to make room — honest busy.
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s, active=1, max_concurrent=1)
        cid = _seed_active_convo(s, uid, lid)
        new_uid = _seed_user(s)
        s.commit()

    r = client.post("/api/v1/match", json={"kind": "general"}, headers=_auth(new_uid))
    assert r.status_code == 503

    with TestSession() as s:
        assert s.get(Conversation, cid).status == ConversationStatus.active
        assert s.get(ListenerProfile, lid).active_conversations == 1


# --- issue_category persistence (spec 2026-09-06 §4.3) --------------------------


@requires_postgres
def test_general_match_stores_the_issue_category_on_the_conversation(client, db_session):
    with TestSession() as s:
        _seed_listener(s)
        uid = _seed_user(s)
        s.commit()

    r = client.post(
        "/api/v1/match",
        json={"kind": "general", "issue_category": "exam_stress"},
        headers=_auth(uid),
    )
    assert r.status_code == 200
    convo_id = r.json()["conversation_id"]

    with TestSession() as s:
        assert s.get(Conversation, convo_id).issue_category == "exam_stress"


@requires_postgres
def test_match_rejects_an_issue_category_over_40_chars(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        s.commit()

    r = client.post(
        "/api/v1/match",
        json={"kind": "general", "issue_category": "a" * 41},
        headers=_auth(uid),
    )
    assert r.status_code == 422


@requires_postgres
def test_personal_accept_stores_the_requests_issue_category(client, db_session):
    from app.security import issue_listener_token

    with TestSession() as s:
        lid = _seed_listener(s)
        uid = _seed_user(s)
        s.commit()

    req = client.post(
        f"/api/v1/listeners/{lid}/request",
        json={"intro_message": "hi", "issue_category": "loneliness"},
        headers=_auth(uid),
    )
    assert req.status_code == 200
    req_id = req.json()["id"]

    accepted = client.post(
        f"/api/v1/listener/me/requests/{req_id}/accept",
        headers={"Authorization": f"Bearer {issue_listener_token(lid)}"},
    )
    assert accepted.status_code == 200
    convo_id = accepted.json()["conversation_id"]

    with TestSession() as s:
        assert s.get(Conversation, convo_id).issue_category == "loneliness"


@requires_postgres
def test_reconcile_racing_a_matcher_keeps_the_new_conversation_counted(db_session):
    """Audit F6. The self-heal runs inline from match_general exactly when matchers
    are busiest. Its recount `UPDATE … SET active = (SELECT count…)` used to wait on a
    matcher's row lock and then write a count taken from its ORIGINAL snapshot — the
    conversation the matcher had just committed was not in it, so the counter landed
    one low and the listener could be over-assigned."""
    import threading
    import time

    from app.services.matching import reconcile_listener_capacity

    with TestSession() as s:
        lid = _seed_listener(s, active=3, max_concurrent=5)
        _seed_active_convo(s, _seed_user(s), lid)
        _seed_active_convo(s, _seed_user(s), lid)
        stale = datetime.now(UTC) - timedelta(hours=25)
        _seed_active_convo(s, _seed_user(s), lid, created_at=stale)
        newcomer = _seed_user(s)
        s.commit()

    def _reconcile() -> None:
        with TestSession() as r:
            reconcile_listener_capacity(r)
            r.commit()

    with TestSession() as matcher:
        li = matcher.execute(
            select(ListenerProfile).where(ListenerProfile.id == lid).with_for_update()
        ).scalar_one()
        li.active_conversations += 1
        _seed_active_convo(matcher, newcomer, lid)
        worker = threading.Thread(target=_reconcile)
        worker.start()
        time.sleep(0.8)  # reconcile runs while the matcher holds the listener row
        matcher.commit()
    worker.join(timeout=15)

    def _counter_and_real() -> tuple[int, int]:
        with TestSession() as s:
            real = (
                s.query(Conversation)
                .filter(Conversation.listener_id == lid, Conversation.status == "active")
                .count()
            )
            return s.get(ListenerProfile, lid).active_conversations, real

    # The busy listener was skipped whole (sweep AND recount), never half-healed:
    # counter and reality agree, with the matcher's conversation counted.
    assert _counter_and_real() == (4, 4)

    # …and the next pass, with nobody holding the row, finishes the job.
    _reconcile()
    assert _counter_and_real() == (3, 3)


@requires_postgres
def test_reconcile_frees_a_slot_leaked_by_a_crash_between_match_phases(client, db_session):
    """Audit F7. open_conversation commits the reservation, then calls Stream. A crash
    in between leaves an active conversation with no channel holding a slot — for 24 h
    before this; now for two minutes."""
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s, active=2)
        orphan = _seed_active_convo(
            s, uid, lid, created_at=datetime.now(UTC) - timedelta(minutes=5)
        )
        in_flight = _seed_active_convo(s, uid, lid)  # seconds old: a match mid-flight
        admin_h = _admin_auth(s)
        s.commit()

    r = client.post("/api/v1/admin/listeners/reconcile", headers=admin_h)
    assert r.status_code == 200
    assert r.json()["stale_ended"] == 1

    with TestSession() as s:
        assert s.get(Conversation, orphan).status == ConversationStatus.ended
        assert s.get(Conversation, in_flight).status == ConversationStatus.active
        assert s.get(ListenerProfile, lid).active_conversations == 1
