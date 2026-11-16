"""DECISIONS T.6 and T.7: message likes in own chats, and mentors' coarse "last seen"."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.enums import ListenerStatus
from app.models.listener import ListenerProfile
from app.services import chat
from app.services.listener_profiles import seen_bucket

from .chat_helpers import seed_chat
from .conftest import requires_postgres

pytestmark = requires_postgres


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _send(db_session, seeded, sender_id: str, text: str, client_id: str) -> int:
    sent = chat.send(db_session, sender_id, seeded.cid, client_id=client_id, body=text)
    return sent.message["seq"]


def test_member_likes_a_mentor_message_once(client, db_session):
    s = seed_chat(db_session)
    seq = _send(db_session, s, s.mentor_id, "How is the preparation going?", "m1")
    auth = {"Authorization": f"Bearer {s.member}"}

    r = client.post(f"/api/v1/chat/{s.cid}/messages/{seq}/like", json={"liked": True}, headers=auth)
    assert r.status_code == 200 and r.json() == {"seq": seq, "liked": True}
    again = client.post(
        f"/api/v1/chat/{s.cid}/messages/{seq}/like", json={"liked": True}, headers=auth
    )
    assert again.status_code == 200

    history = client.get(f"/api/v1/chat/{s.cid}/messages", headers=auth).json()["messages"]
    assert [m["liked"] for m in history] == [True]

    off = client.post(
        f"/api/v1/chat/{s.cid}/messages/{seq}/like", json={"liked": False}, headers=auth
    )
    assert off.json()["liked"] is False


def test_no_one_likes_their_own_message_or_a_stranger_s(client, db_session):
    s = seed_chat(db_session)
    seq = _send(db_session, s, s.member_id, "Thank you", "u1")
    own = client.post(
        f"/api/v1/chat/{s.cid}/messages/{seq}/like",
        json={"liked": True},
        headers={"Authorization": f"Bearer {s.member}"},
    )
    assert own.status_code == 404
    other = seed_chat(db_session)
    stranger = client.post(
        f"/api/v1/chat/{s.cid}/messages/{seq}/like",
        json={"liked": True},
        headers={"Authorization": f"Bearer {other.mentor}"},
    )
    assert stranger.status_code == 404
    missing = client.post(
        f"/api/v1/chat/{s.cid}/messages/999/like",
        json={"liked": True},
        headers={"Authorization": f"Bearer {s.mentor}"},
    )
    assert missing.status_code == 404


def test_seen_is_a_bucket_never_a_time():
    now = datetime(2026, 11, 16, 12, tzinfo=UTC)
    li = ListenerProfile(status=ListenerStatus.online)
    assert seen_bucket(li, now) == "now"
    li.status = ListenerStatus.away
    assert seen_bucket(li, now) is None
    for gap, want in [
        (timedelta(hours=3), "day"),
        (timedelta(days=3), "week"),
        (timedelta(days=30), "earlier"),
    ]:
        li.last_online_at = now - gap
        assert seen_bucket(li, now) == want


def test_going_away_stamps_last_online(client, db_session):
    s = seed_chat(db_session)
    r = client.patch(
        "/api/v1/listener/me/status",
        json={"status": "away"},
        headers={"Authorization": f"Bearer {s.mentor}"},
    )
    assert r.status_code == 200, r.text
    db_session.expire_all()
    li = db_session.get(ListenerProfile, s.mentor_id)
    assert li.last_online_at is not None
    card = client.get(
        f"/api/v1/listeners/{s.mentor_id}", headers={"Authorization": f"Bearer {s.member}"}
    )
    assert card.json()["seen"] == "day"


def test_earnings_are_stubs_with_real_counts(client, db_session):
    s = seed_chat(db_session)
    r = client.get("/api/v1/listener/me/earnings", headers={"Authorization": f"Bearer {s.mentor}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["balance_paise"] == 0 and body["payments_live"] is False
    assert body["mentorship_sessions"] == 1
    member = client.get(
        "/api/v1/listener/me/earnings", headers={"Authorization": f"Bearer {s.member}"}
    )
    assert member.status_code in (401, 403)
