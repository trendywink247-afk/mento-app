"""Broadcast requests (docs/DECISIONS.md §P.4): "Next available" on an exam road is offered to every
certified mentor; the first to accept takes it, and it leaves everyone else's inbox."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.main import app
from app.models.enums import ListenerStatus, RequestStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.moderation import ModerationEvent
from app.models.request import ConversationRequest, RequestPass
from app.models.user import User
from app.security import issue_listener_token, issue_session_token
from app.services import matching, push, stream
from app.services.paths_data import COMMUNITIES

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture(autouse=True)
def _stream(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )
    monkeypatch.setattr(stream, "post_message", lambda *a, **k: None)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, conversations, conversation_requests, "
                "request_passes CASCADE"
            )
        )
        s.commit()
    yield


def _member(s, community="upsc") -> str:
    u = User(
        persona_name="Quiet Cove",
        persona_avatar="x",
        dob=date(1996, 1, 1),
        age_at_signup=30,
        community_slug=community,
        journey_stage=next(iter(COMMUNITIES[community]["stages"])),
    )
    s.add(u)
    s.flush()
    return u.id


def _mentor(s, name, *, certified=True, status=ListenerStatus.online, active=0) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="seed",
        categories=[],
        status=status,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=active,
        max_concurrent=3,
        certified_exam=certified,
    )
    s.add(li)
    s.flush()
    return li.id


def _auth(user_id):
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def _lauth(listener_id):
    return {"Authorization": f"Bearer {issue_listener_token(listener_id)}"}


def _ask(client, member):
    r = client.post("/api/v1/match/ask", json={}, headers=_auth(member))
    assert r.status_code == 200, r.text
    return r.json()


def _inbox(client, listener_id) -> list[str]:
    r = client.get("/api/v1/listener/me/requests", headers=_lauth(listener_id))
    assert r.status_code == 200, r.text
    return [x["id"] for x in r.json()]


def test_a_broadcast_is_in_every_certified_mentors_inbox_and_nobody_else(client):
    with TestSession() as s:
        member = _member(s)
        a = _mentor(s, "Cedar")
        b = _mentor(s, "Maple")
        plain = _mentor(s, "Willow", certified=False)
        s.commit()
    asked = _ask(client, member)
    assert _inbox(client, a) == [asked["id"]] and _inbox(client, b) == [asked["id"]]
    assert _inbox(client, plain) == []
    row = client.get("/api/v1/listener/me/requests", headers=_lauth(a)).json()[0]
    assert row["broadcast"] is True


def test_the_first_to_accept_takes_it_and_it_leaves_the_others(client):
    with TestSession() as s:
        member = _member(s)
        a = _mentor(s, "Cedar")
        b = _mentor(s, "Maple")
        s.commit()
    asked = _ask(client, member)
    first = client.post(f"/api/v1/listener/me/requests/{asked['id']}/accept", headers=_lauth(a))
    assert first.status_code == 200 and first.json()["conversation_id"]
    assert first.json()["target_listener_id"] == a
    second = client.post(f"/api/v1/listener/me/requests/{asked['id']}/accept", headers=_lauth(b))
    assert second.status_code == 404  # already taken
    assert _inbox(client, b) == []
    with TestSession() as s:
        assert s.get(ConversationRequest, asked["id"]).target_listener_id == a


def test_passing_leaves_it_open_for_the_others(client):
    with TestSession() as s:
        member = _member(s)
        a = _mentor(s, "Cedar")
        b = _mentor(s, "Maple")
        s.commit()
    asked = _ask(client, member)
    r = client.post(f"/api/v1/listener/me/requests/{asked['id']}/decline", headers=_lauth(a))
    assert r.status_code == 200
    assert _inbox(client, a) == [] and _inbox(client, b) == [asked["id"]]
    with TestSession() as s:
        row = s.get(ConversationRequest, asked["id"])
        assert row.status == RequestStatus.pending and row.target_listener_id is None
        assert s.scalars(select(RequestPass)).one().listener_id == a
    # and a mentor who passed cannot take it afterwards
    assert (
        client.post(
            f"/api/v1/listener/me/requests/{asked['id']}/accept", headers=_lauth(a)
        ).status_code
        == 404
    )


def test_a_mentor_the_member_blocked_never_sees_it(client):
    with TestSession() as s:
        member = _member(s)
        blocked = _mentor(s, "Cedar")
        ok = _mentor(s, "Maple")
        s.add(ModerationEvent(reporter_id=member, subject_id=blocked, blocked=True))
        s.commit()
    asked = _ask(client, member)
    assert _inbox(client, blocked) == [] and _inbox(client, ok) == [asked["id"]]
    r = client.post(f"/api/v1/listener/me/requests/{asked['id']}/accept", headers=_lauth(blocked))
    assert r.status_code == 404
    with TestSession() as s:
        assert s.get(ConversationRequest, asked["id"]).status == RequestStatus.pending


def test_a_full_mentor_accepting_leaves_it_open_for_the_others(client):
    with TestSession() as s:
        member = _member(s)
        full = _mentor(s, "Cedar", active=3)
        other = _mentor(s, "Maple")
        s.commit()
    asked = _ask(client, member)
    # a full mentor is not even offered it
    assert _inbox(client, other) == [asked["id"]]
    r = client.post(f"/api/v1/listener/me/requests/{asked['id']}/accept", headers=_lauth(full))
    assert r.status_code == 409
    with TestSession() as s:
        row = s.get(ConversationRequest, asked["id"])
        assert row.status == RequestStatus.pending and row.target_listener_id is None


def test_the_member_can_withdraw_a_broadcast_and_it_leaves_every_inbox(client):
    with TestSession() as s:
        member = _member(s)
        a = _mentor(s, "Cedar")
        s.commit()
    asked = _ask(client, member)
    r = client.delete(f"/api/v1/listeners/requests/{asked['id']}", headers=_auth(member))
    assert r.status_code == 200 and r.json()["status"] == "expired"
    assert _inbox(client, a) == []


def test_candidates_are_online_certified_with_room_and_capped_at_twenty():
    with TestSession() as s:
        member = _member(s)
        ids = [_mentor(s, f"Mentor {i}") for i in range(25)]
        _mentor(s, "Plain", certified=False)
        _mentor(s, "Away", status=ListenerStatus.away)
        _mentor(s, "Busy", active=3)
        s.commit()
        got = matching.broadcast_candidate_ids(s, None, set(), community="upsc")
    assert len(got) == matching.BROADCAST_LIMIT == 20 and set(got) <= set(ids) and member


def test_the_push_guard_allows_only_mentors_who_can_still_take_it(client):
    with TestSession() as s:
        member = _member(s)
        a = _mentor(s, "Cedar")
        b = _mentor(s, "Maple")
        s.commit()
    asked = _ask(client, member)
    from app.models.enums import PushOwnerKind

    with TestSession() as s:
        data = {"kind": "request", "request_id": asked["id"]}
        assert push._delivery_allowed(s, PushOwnerKind.listener, a, data)
    client.post(f"/api/v1/listener/me/requests/{asked['id']}/accept", headers=_lauth(a))
    with TestSession() as s:
        data = {"kind": "request", "request_id": asked["id"]}
        assert not push._delivery_allowed(s, PushOwnerKind.listener, b, data)
