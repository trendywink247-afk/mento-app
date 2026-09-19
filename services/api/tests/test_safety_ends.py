"""Safety ends reach Stream, and no end path can drift the capacity counter (audit F3/F5).

Report / Block / Suspend used to change Postgres only: the Stream channel stayed open
and the mentor's Stream token never expires, so a blocked or suspended mentor could
keep writing to the member. They now freeze the channel. Plain End does not.
"""

from __future__ import annotations

import threading
import time
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.admin import AdminAccount
from app.models.conversation import Conversation
from app.models.enums import (
    AdminRole,
    ConversationEndedBy,
    ConversationStatus,
    ListenerStatus,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.moderation import ModerationEvent
from app.models.user import User
from app.security import issue_admin_token, issue_session_token
from app.services import conversations, stream

from .conftest import TestSession, requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


def _user(s, name="Quiet Cove") -> str:
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _listener(s, *, active: int) -> str:
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=active,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _convo(s, uid: str, lid: str) -> tuple[str, str]:
    channel = f"ch-{uuid.uuid4().hex[:10]}"
    c = Conversation(
        type="anon",
        status=ConversationStatus.active,
        user_id=uid,
        listener_id=lid,
        stream_channel_id=channel,
    )
    s.add(c)
    s.flush()
    return c.id, channel


def _auth(uid: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _admin(s) -> dict:
    a = AdminAccount(name="Founder", role=AdminRole.owner)
    s.add(a)
    s.flush()
    return {"Authorization": f"Bearer {issue_admin_token(a.id)}"}


@requires_postgres
@pytest.mark.parametrize("action", ["report", "block"])
def test_report_and_block_freeze_the_stream_channel(client, db_session, sealed_channels, action):
    with TestSession() as s:
        uid = _user(s)
        lid = _listener(s, active=1)
        cid, channel = _convo(s, uid, lid)
        s.commit()
    r = client.post(f"/api/v1/conversations/{cid}/{action}", json={}, headers=_auth(uid))
    assert r.status_code == 200
    assert sealed_channels == [channel]


@requires_postgres
def test_plain_end_does_not_freeze(client, db_session, sealed_channels):
    with TestSession() as s:
        uid = _user(s)
        lid = _listener(s, active=1)
        cid, _ = _convo(s, uid, lid)
        s.commit()
    assert client.post(f"/api/v1/conversations/{cid}/end", headers=_auth(uid)).status_code == 200
    assert sealed_channels == []


@requires_postgres
def test_a_stream_outage_never_stops_a_report(client, db_session, monkeypatch):
    monkeypatch.setattr(stream, "freeze_channel", lambda channel_id: False)
    with TestSession() as s:
        uid = _user(s)
        lid = _listener(s, active=1)
        cid, _ = _convo(s, uid, lid)
        s.commit()
    r = client.post(f"/api/v1/conversations/{cid}/report", json={}, headers=_auth(uid))
    assert r.status_code == 200
    with TestSession() as s:
        assert s.query(ModerationEvent).filter_by(conversation_id=cid).count() == 1
        assert s.get(Conversation, cid).status == ConversationStatus.ended
        assert s.get(ListenerProfile, lid).active_conversations == 0


def test_freeze_channel_swallows_stream_errors(monkeypatch):
    class _Boom:
        def channel(self, *_a, **_k):
            raise RuntimeError("stream down")

    monkeypatch.undo()  # drop conftest's recorder — exercise the real function
    monkeypatch.setattr(stream, "_client", lambda: _Boom())
    assert stream.freeze_channel("ch-1") is False


@requires_postgres
def test_suspend_ends_the_mentors_chats_frees_slots_and_freezes(
    client, db_session, sealed_channels
):
    with TestSession() as s:
        lid = _listener(s, active=2)
        other = _listener(s, active=1)
        c1, ch1 = _convo(s, _user(s, "One"), lid)
        c2, ch2 = _convo(s, _user(s, "Two"), lid)
        untouched, _ = _convo(s, _user(s, "Three"), other)
        admin_h = _admin(s)
        s.commit()

    r = client.post(f"/api/v1/admin/listeners/{lid}/suspend", headers=admin_h)
    assert r.status_code == 200

    with TestSession() as s:
        for cid in (c1, c2):
            convo = s.get(Conversation, cid)
            assert convo.status == ConversationStatus.ended
            assert convo.ended_by == ConversationEndedBy.system
        assert s.get(ListenerProfile, lid).active_conversations == 0
        assert s.get(ListenerProfile, lid).vetting_status == VettingStatus.suspended
        assert s.get(Conversation, untouched).status == ConversationStatus.active
        assert s.get(ListenerProfile, other).active_conversations == 1
    assert sorted(sealed_channels) == sorted([ch1, ch2])


@requires_postgres
def test_report_racing_a_mentor_end_releases_the_slot_once(client, db_session):
    """The mentor's End holds the conversation row lock; the member's Report arrives
    meanwhile. Unlocked, the report read `active`, released the slot a second time
    (or deadlocked on the opposite lock order). Locked, it waits, sees `ended`, files
    the event and releases nothing."""
    with TestSession() as s:
        uid = _user(s)
        lid = _listener(s, active=2)  # this chat + one other
        cid, _ = _convo(s, uid, lid)
        s.commit()

    result: dict = {}

    def _report() -> None:
        result["status"] = client.post(
            f"/api/v1/conversations/{cid}/report", json={}, headers=_auth(uid)
        ).status_code

    with TestSession() as mentor:
        convo = conversations.lock(mentor, cid)
        worker = threading.Thread(target=_report)
        worker.start()
        time.sleep(0.6)  # let the report reach (and block on) the row lock
        assert conversations.end(mentor, convo, ConversationEndedBy.listener) is True
        mentor.commit()
    worker.join(timeout=15)

    assert result.get("status") == 200
    with TestSession() as s:
        assert s.get(ListenerProfile, lid).active_conversations == 1
        assert s.get(Conversation, cid).ended_by == ConversationEndedBy.listener
        assert s.query(ModerationEvent).filter_by(conversation_id=cid).count() == 1
