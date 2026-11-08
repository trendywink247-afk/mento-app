"""DECISIONS §P.5-6: an unanswered request asks the member at 24 hours and closes at 48, nothing
moves to another mentor by itself, and a mentor's usual reply time is shown only when fair."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    ListenerStatus,
    PushOwnerKind,
    RequestKind,
    RequestStatus,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.request import ConversationRequest
from app.models.user import User
from app.security import issue_session_token
from app.services import push, reply_time, request_ageing

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


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


def _member(s) -> str:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _mentor(s, name="Cedar") -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="seed",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
        certified_exam=True,
    )
    s.add(li)
    s.flush()
    return li.id


def _request(s, member, mentor, *, age_h, broadcast=False, status=RequestStatus.pending) -> str:
    r = ConversationRequest(
        kind=RequestKind.general if broadcast else RequestKind.personal,
        broadcast=broadcast,
        status=status,
        requester_id=member,
        target_listener_id=None if broadcast else mentor,
        intro_message="Hello",
        created_at=datetime.now(UTC) - timedelta(hours=age_h),
    )
    s.add(r)
    s.flush()
    return r.id


def test_at_24_hours_the_member_is_nudged_once_and_at_48_it_closes():
    with TestSession() as s:
        m, li = _member(s), _mentor(s)
        young = _request(s, m, li, age_h=5)
        day = _request(s, m, li, age_h=25)
        old = _request(s, m, li, age_h=49)
        s.commit()
        first = request_ageing.run(s)
        s.commit()
        assert first["nudged"] == [day] and first["expired"] == [old]
        again = request_ageing.run(s)
        assert again == {"expired": [], "nudged": []}  # once only
        s.commit()
        assert s.get(ConversationRequest, young).status == RequestStatus.pending
        assert s.get(ConversationRequest, day).nudged_at is not None
        assert s.get(ConversationRequest, old).status == RequestStatus.expired


def test_nothing_is_moved_to_another_mentor():
    with TestSession() as s:
        m, li = _member(s), _mentor(s)
        rid = _request(s, m, li, age_h=30)
        s.commit()
        request_ageing.run(s)
        s.commit()
        row = s.get(ConversationRequest, rid)
        assert row.target_listener_id == li and row.broadcast is False


def test_the_request_says_it_was_nudged_only_while_pending(client):
    with TestSession() as s:
        m, li = _member(s), _mentor(s)
        rid = _request(s, m, li, age_h=30)
        s.commit()
        request_ageing.run(s)
        s.commit()
    r = client.get(
        "/api/v1/listeners/requests/mine",
        headers={"Authorization": f"Bearer {issue_session_token(m)}"},
    )
    assert r.status_code == 200
    assert [(x["id"], x["nudged"]) for x in r.json()] == [(rid, True)]


def test_the_nudge_push_reaches_only_the_asker_while_pending():
    with TestSession() as s:
        m, li = _member(s), _mentor(s)
        rid = _request(s, m, li, age_h=30)
        s.commit()
        data = {"kind": "request_nudge", "request_id": rid}
        assert push._delivery_allowed(s, PushOwnerKind.member, m, data)
        assert not push._delivery_allowed(s, PushOwnerKind.member, "someone-else", data)
        assert not push._delivery_allowed(s, PushOwnerKind.listener, li, data)
        s.get(ConversationRequest, rid).status = RequestStatus.expired
        s.commit()
        assert not push._delivery_allowed(s, PushOwnerKind.member, m, data)
    assert "request_nudge" in push.TEMPLATES and "%" not in push.TEMPLATES["request_nudge"]


def _answered(s, member, mentor, *, took_h):
    asked = datetime.now(UTC) - timedelta(hours=100)
    convo = Conversation(
        user_id=member,
        listener_id=mentor,
        status=ConversationStatus.ended,
        created_at=asked + timedelta(hours=took_h),
    )
    s.add(convo)
    s.flush()
    r = ConversationRequest(
        kind=RequestKind.personal,
        status=RequestStatus.matched,
        requester_id=member,
        target_listener_id=mentor,
        conversation_id=convo.id,
        created_at=asked,
    )
    s.add(r)
    s.flush()


def test_reply_time_needs_five_requests_then_buckets_by_the_median():
    with TestSession() as s:
        m = _member(s)
        quick, slow, thin = _mentor(s, "Quick"), _mentor(s, "Slow"), _mentor(s, "Thin")
        for hours in (1, 2, 3, 30, 5):
            _answered(s, m, quick, took_h=hours)
        for hours in (30, 40, 45, 3, 47):
            _answered(s, m, slow, took_h=hours)
        for hours in (1, 2, 3, 4):
            _answered(s, m, thin, took_h=hours)
        s.commit()
        got = reply_time.reply_within(s, [quick, slow, thin])
    assert got == {quick: "day", slow: "two_days", thin: None}


def test_unanswered_requests_count_as_slow():
    with TestSession() as s:
        m, li = _member(s), _mentor(s)
        for _ in range(5):
            rid = _request(s, m, li, age_h=60, status=RequestStatus.expired)
            s.get(ConversationRequest, rid).nudged_at = datetime.now(UTC) - timedelta(hours=30)
        s.commit()
        assert reply_time.reply_within(s, [li]) == {li: None}  # slower than two days: no badge


def test_browse_shows_the_badge(client):
    with TestSession() as s:
        m, li = _member(s), _mentor(s)
        for hours in (1, 2, 3, 4, 5):
            _answered(s, m, li, took_h=hours)
        s.commit()
    r = client.get(
        "/api/v1/listeners", headers={"Authorization": f"Bearer {issue_session_token(m)}"}
    )
    assert r.status_code == 200, r.text
    assert [x["reply_within"] for x in r.json()] == ["day"]
