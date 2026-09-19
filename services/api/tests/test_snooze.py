"""Snooze 24 h (board A10; DECISIONS §L, founder 2026-09-19): scoping, the window,
undo, ordering, what the member sees, crisis ends it, the stale sweep and the mentor's
pushes leave a snoozed chat alone — and nothing else changes."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import ratelimit
from app.main import app
from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    ListenerStatus,
    PushOwnerKind,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.push_token import PushToken
from app.models.user import User
from app.security import issue_listener_token, issue_session_token
from app.services import matching, push, stream

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres

BEFORE = "/api/v1/stream/before-message-send"
HOOK = "/api/v1/stream/webhook"


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, conversations, push_tokens, "
                "safety_flags, message_allowance_days CASCADE"
            )
        )
        s.commit()
    yield


@pytest.fixture(autouse=True)
def _stream_stub(monkeypatch):
    monkeypatch.setattr(stream, "user_token", lambda uid: f"stream-{uid}")
    monkeypatch.setattr(stream, "verify_webhook", lambda body, sig: True)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def sent(monkeypatch):
    calls: list[dict] = []

    def fake_post(messages: list[dict]) -> list[dict]:
        calls.extend(messages)
        return [{"status": "ok"} for _ in messages]

    monkeypatch.setattr(push, "ENABLED", True)
    monkeypatch.setattr(push, "_post_expo", fake_post)
    monkeypatch.setattr(push, "_is_watching", lambda channel_id, user_id: False)
    monkeypatch.setattr(push, "_burst_open", lambda conversation_id, recipient_id: True)
    return calls


def _user(s, name="Quiet Cove") -> str:
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _listener(s, name="Open River") -> str:
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


def _convo(s, user_id: str, listener_id: str, *, created_at: datetime | None = None) -> str:
    s.get(ListenerProfile, listener_id).active_conversations += 1
    c = Conversation(
        user_id=user_id,
        listener_id=listener_id,
        stream_channel_id=f"ch-{uuid.uuid4().hex[:12]}",
    )
    if created_at is not None:
        c.created_at = created_at
    s.add(c)
    s.flush()
    return c.id


def _pair(created_at: datetime | None = None) -> tuple[str, str, str, str]:
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        cid = _convo(s, uid, lid, created_at=created_at)
        channel = s.get(Conversation, cid).stream_channel_id
        s.commit()
    return uid, lid, cid, channel


def mentor(lid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_listener_token(lid)}"}


def member(uid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _snooze_url(cid: str) -> str:
    return f"/api/v1/listener/me/conversations/{cid}/snooze"


def _snoozed_until(cid: str) -> datetime | None:
    with TestSession() as s:
        value = s.get(Conversation, cid).snoozed_until
    return value.astimezone(UTC) if value else None


# --- the window, undo, idempotence -------------------------------------------------


def test_snooze_opens_a_24_hour_window_and_undo_closes_it(client):
    _uid, lid, cid, _ch = _pair()
    before = datetime.now(UTC)
    r = client.post(_snooze_url(cid), headers=mentor(lid))
    assert r.status_code == 200, r.text
    until = datetime.fromisoformat(r.json()["snoozed_until"])
    assert timedelta(hours=23, minutes=59) < until - before <= timedelta(hours=24, seconds=5)
    assert _snoozed_until(cid) is not None

    listed = client.get("/api/v1/listener/me/conversations", headers=mentor(lid)).json()
    assert listed[0]["snoozed_until"] == r.json()["snoozed_until"]

    undo = client.delete(_snooze_url(cid), headers=mentor(lid))
    assert undo.status_code == 200 and undo.json() == {"id": cid, "snoozed_until": None}
    assert _snoozed_until(cid) is None
    # Undo is idempotent.
    assert client.delete(_snooze_url(cid), headers=mentor(lid)).status_code == 200


def test_snoozing_again_never_extends_the_window(client):
    _uid, lid, cid, _ch = _pair()
    first = client.post(_snooze_url(cid), headers=mentor(lid)).json()["snoozed_until"]
    second = client.post(_snooze_url(cid), headers=mentor(lid)).json()["snoozed_until"]
    assert first == second


def test_an_expired_snooze_reads_as_not_snoozed(client):
    uid, lid, cid, _ch = _pair()
    with TestSession() as s:
        s.get(Conversation, cid).snoozed_until = datetime.now(UTC) - timedelta(minutes=1)
        s.commit()
    listed = client.get("/api/v1/listener/me/conversations", headers=mentor(lid)).json()
    assert listed[0]["snoozed_until"] is None
    mine = client.get("/api/v1/conversations", headers=member(uid)).json()
    assert mine[0]["reply_within_a_day"] is False


# --- scoping -------------------------------------------------------------------------


def test_another_mentors_conversation_is_an_opaque_404(client):
    _uid, _lid, cid, _ch = _pair()
    with TestSession() as s:
        other = _listener(s, name="Still Lake")
        s.commit()
    assert client.post(_snooze_url(cid), headers=mentor(other)).status_code == 404
    assert client.delete(_snooze_url(cid), headers=mentor(other)).status_code == 404
    assert client.post(_snooze_url(str(uuid.uuid4())), headers=mentor(other)).status_code == 404
    assert _snoozed_until(cid) is None


def test_a_member_token_cannot_snooze(client):
    uid, _lid, cid, _ch = _pair()
    assert client.post(_snooze_url(cid), headers=member(uid)).status_code in (401, 403)


def test_an_ended_conversation_cannot_be_snoozed(client):
    _uid, lid, cid, _ch = _pair()
    with TestSession() as s:
        s.get(Conversation, cid).status = ConversationStatus.ended
        s.commit()
    r = client.post(_snooze_url(cid), headers=mentor(lid))
    assert r.status_code == 409
    assert r.json()["code"] == "not_active"


def test_a_suspended_mentor_cannot_snooze(client):
    _uid, lid, cid, _ch = _pair()
    with TestSession() as s:
        s.get(ListenerProfile, lid).vetting_status = VettingStatus.suspended
        s.commit()
    assert client.post(_snooze_url(cid), headers=mentor(lid)).status_code == 403


def test_snooze_is_rate_limited(client):
    _uid, lid, cid, _ch = _pair()
    ratelimit.ENABLED = True
    try:
        if not ratelimit.allow(f"probe:{uuid.uuid4()}", 1, 5):
            pytest.skip("Redis unavailable — limiter fails open by design")
        codes = [client.post(_snooze_url(cid), headers=mentor(lid)).status_code for _ in range(31)]
    finally:
        ratelimit.ENABLED = False
    assert codes[:30] == [200] * 30
    assert codes[30] == 429


# --- ordering and what the member sees ----------------------------------------------


def test_snoozed_chats_sort_after_awake_ones_and_before_ended(client):
    with TestSession() as s:
        lid = _listener(s)
        now = datetime.now(UTC)
        ended = _convo(s, _user(s, "Far Hill"), lid, created_at=now)
        s.get(Conversation, ended).status = ConversationStatus.ended
        snoozed = _convo(s, _user(s, "Soft Meadow"), lid, created_at=now - timedelta(minutes=1))
        awake = _convo(s, _user(s, "Quiet Juniper"), lid, created_at=now - timedelta(hours=2))
        s.commit()
    client.post(_snooze_url(snoozed), headers=mentor(lid))
    order = [
        c["id"] for c in client.get("/api/v1/listener/me/conversations", headers=mentor(lid)).json()
    ]
    assert order == [awake, snoozed, ended]


def test_member_sees_only_the_kind_line(client):
    uid, lid, cid, _ch = _pair()
    client.post(_snooze_url(cid), headers=mentor(lid))
    row = client.get("/api/v1/conversations", headers=member(uid)).json()[0]
    assert row["reply_within_a_day"] is True
    assert "snooze" not in str(row).lower()
    profile = client.get(f"/api/v1/conversations/{cid}/mentor", headers=member(uid)).json()
    assert profile["reply_within_a_day"] is True
    assert "snooze" not in str(profile).lower()


# --- crisis always ends it; an ordinary member message does not ----------------------


def test_a_crisis_flagged_member_message_ends_the_snooze(client):
    uid, lid, cid, channel = _pair()
    client.post(_snooze_url(cid), headers=mentor(lid))
    r = client.post(
        BEFORE,
        json={
            "message": {"id": f"m-{uuid.uuid4()}", "text": "honestly I want to die"},
            "user": {"id": uid},
            "channel": {"id": channel},
        },
    )
    assert r.status_code == 200
    # The scan still ran first: the helpline card is on the message.
    assert r.json()["message"]["crisis"]["signal"] == "suicidal"
    assert _snoozed_until(cid) is None


def test_the_async_net_ends_the_snooze_too(client, sent):
    """The sync hook can degrade (DB down) — the retried message.new net ends it, and
    the mentor IS pushed for that message."""
    uid, lid, cid, channel = _pair()
    with TestSession() as s:
        s.add(
            PushToken(
                user_id=lid,
                owner_kind=PushOwnerKind.listener,
                owner_id=lid,
                expo_push_token="ExponentPushToken[mentor]",
                platform="android",
            )
        )
        s.commit()
    client.post(_snooze_url(cid), headers=mentor(lid))
    r = client.post(
        HOOK,
        json={
            "type": "message.new",
            "message": {"id": f"m-{uuid.uuid4()}", "text": "i want to die", "user": {"id": uid}},
            "channel": {"id": channel},
        },
    )
    assert r.status_code == 200
    assert _snoozed_until(cid) is None
    assert len(sent) == 1 and sent[0]["to"] == "ExponentPushToken[mentor]"


def test_an_ordinary_member_message_keeps_the_snooze(client):
    uid, lid, cid, channel = _pair()
    client.post(_snooze_url(cid), headers=mentor(lid))
    for hook in (BEFORE, HOOK):
        r = client.post(
            hook,
            json={
                "type": "message.new",
                "message": {
                    "id": f"m-{uuid.uuid4()}",
                    "text": "no rush, just thinking aloud",
                    "user": {"id": uid},
                },
                "user": {"id": uid},
                "channel": {"id": channel},
            },
        )
        assert r.status_code == 200
    assert _snoozed_until(cid) is not None


def test_the_mentors_own_reply_ends_the_snooze(client):
    uid, lid, cid, channel = _pair()
    client.post(_snooze_url(cid), headers=mentor(lid))
    r = client.post(
        HOOK,
        json={
            "type": "message.new",
            "message": {"id": f"m-{uuid.uuid4()}", "text": "I'm here now.", "user": {"id": lid}},
            "channel": {"id": channel},
        },
    )
    assert r.status_code == 200
    assert _snoozed_until(cid) is None
    row = client.get("/api/v1/conversations", headers=member(uid)).json()[0]
    assert row["reply_within_a_day"] is False


# --- pushes and the stale sweep --------------------------------------------------------


def test_no_message_push_to_the_mentor_while_snoozed(client, sent):
    uid, lid, cid, _ch = _pair()
    with TestSession() as s:
        s.add(
            PushToken(
                user_id=lid,
                owner_kind=PushOwnerKind.listener,
                owner_id=lid,
                expo_push_token="ExponentPushToken[mentor]",
                platform="android",
            )
        )
        s.add(
            PushToken(
                user_id=uid,
                owner_kind=PushOwnerKind.member,
                owner_id=uid,
                expo_push_token="ExponentPushToken[member]",
                platform="android",
            )
        )
        s.commit()
    client.post(_snooze_url(cid), headers=mentor(lid))
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=uid)
    assert sent == []
    # The member is still pushed when the mentor writes (the snooze is the mentor's).
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=lid)
    assert [m["to"] for m in sent] == ["ExponentPushToken[member]"]
    # After undo the mentor is pushed again.
    client.delete(_snooze_url(cid), headers=mentor(lid))
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=uid)
    assert sent[-1]["to"] == "ExponentPushToken[mentor]"


def test_the_stale_sweep_skips_a_snoozed_chat_until_its_window_closes(client):
    old = datetime.now(UTC) - timedelta(hours=30)
    _uid, lid, cid, _ch = _pair(created_at=old)
    client.post(_snooze_url(cid), headers=mentor(lid))
    with TestSession() as s:
        healed = matching.reconcile_listener_capacity(s)
        s.commit()
    assert healed["stale_ended"] == 0
    with TestSession() as s:
        assert s.get(Conversation, cid).status == ConversationStatus.active
        assert s.get(ListenerProfile, lid).active_conversations == 1
        # The window closes: the next pass ends it as usual.
        s.get(Conversation, cid).snoozed_until = datetime.now(UTC) - timedelta(seconds=1)
        s.commit()
    with TestSession() as s:
        healed = matching.reconcile_listener_capacity(s)
        s.commit()
    assert healed["stale_ended"] == 1
    with TestSession() as s:
        assert s.get(Conversation, cid).status == ConversationStatus.ended
        assert s.get(ListenerProfile, lid).active_conversations == 0
