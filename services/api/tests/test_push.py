"""Push notifications (spec 2026-09-05): token ownership, triggers, suppression, resilience."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app import ratelimit
from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, PushOwnerKind, VettingStatus
from app.models.listener import ListenerProfile
from app.models.push_token import PushToken
from app.models.request import ConversationRequest
from app.models.user import User
from app.security import issue_listener_token, issue_session_token
from app.services import push, stream

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, conversations, conversation_requests, "
                "push_tokens, safety_flags CASCADE"
            )
        )
        s.commit()
    yield


@pytest.fixture(autouse=True)
def _stream_stub(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )
    monkeypatch.setattr(stream, "user_token", lambda uid: f"stream-{uid}")


@pytest.fixture
def sent(monkeypatch):
    """Turn push ON for this test and record every Expo send instead of calling out."""
    calls: list[dict] = []

    def fake_post(messages: list[dict]) -> list[dict]:
        calls.extend(messages)
        return [{"status": "ok"} for _ in messages]

    monkeypatch.setattr(push, "ENABLED", True)
    monkeypatch.setattr(push, "_post_expo", fake_post)
    monkeypatch.setattr(push, "_is_watching", lambda channel_id, user_id: False)
    return calls


@pytest.fixture
def client():
    return TestClient(app)


def _user(s, name="Quiet Cove") -> str:
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _listener(
    s, *, name="Open River", vetting=VettingStatus.approved, status=ListenerStatus.online
) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="river",
        categories=["loneliness"],
        status=status,
        vetting_status=vetting,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _token(s, kind: PushOwnerKind, owner_id: str, value: str) -> None:
    s.add(
        PushToken(
            user_id=owner_id,
            owner_kind=kind,
            owner_id=owner_id,
            expo_push_token=value,
            platform="android",
        )
    )
    s.flush()


def _convo(s, user_id: str, listener_id: str, *, paused=False) -> str:
    c = Conversation(
        user_id=user_id,
        listener_id=listener_id,
        stream_channel_id=f"ch-{user_id[:8]}",
        is_paused=paused,
    )
    s.add(c)
    s.flush()
    return c.id


def member_auth(uid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def listener_auth(lid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_listener_token(lid)}"}


# --- ownership ------------------------------------------------------------------


def test_member_register_sets_owner_member(client):
    with TestSession() as s:
        uid = _user(s)
        s.commit()
    r = client.post(
        "/api/v1/notifications/register-token",
        json={"expo_push_token": "ExponentPushToken[m1]", "platform": "android"},
        headers=member_auth(uid),
    )
    assert r.status_code == 200
    with TestSession() as s:
        row = s.scalars(select(PushToken)).one()
        assert row.owner_kind == PushOwnerKind.member and row.owner_id == uid and row.user_id == uid


def test_one_device_keeps_a_row_per_role(client):
    """A phone that is both a member and a mentor registers the SAME token twice —
    once per role — and must keep both rows (session 31f: a single-token rule let
    the member tab steal the mentor's row, silencing mentor pushes)."""
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        s.commit()
    tok = "ExponentPushToken[one-device]"
    client.post(
        "/api/v1/notifications/register-token",
        json={"expo_push_token": tok, "platform": "android"},
        headers=member_auth(uid),
    )
    r = client.post(
        "/api/v1/listener/me/push-token",
        json={"expo_push_token": tok, "platform": "android"},
        headers=listener_auth(lid),
    )
    assert r.status_code == 200 and r.json()["status"] == "registered"
    with TestSession() as s:
        rows = {t.owner_kind: t.owner_id for t in s.scalars(select(PushToken)).all()}
        assert rows == {PushOwnerKind.member: uid, PushOwnerKind.listener: lid}
    # Re-registering as a NEW member (reinstall) re-points only the member row.
    with TestSession() as s:
        uid2 = _user(s, "Still Pine")
        s.commit()
    client.post(
        "/api/v1/notifications/register-token",
        json={"expo_push_token": tok, "platform": "android"},
        headers=member_auth(uid2),
    )
    with TestSession() as s:
        rows = {t.owner_kind: t.owner_id for t in s.scalars(select(PushToken)).all()}
        assert rows == {PushOwnerKind.member: uid2, PushOwnerKind.listener: lid}


def test_listener_register_refused_when_suspended(client):
    with TestSession() as s:
        lid = _listener(s, vetting=VettingStatus.suspended)
        s.commit()
    r = client.post(
        "/api/v1/listener/me/push-token",
        json={"expo_push_token": "ExponentPushToken[x]", "platform": "android"},
        headers=listener_auth(lid),
    )
    assert r.status_code == 403


def test_member_delete_removes_only_own_token(client):
    with TestSession() as s:
        a, b = _user(s), _user(s, "Still Pine")
        _token(s, PushOwnerKind.member, a, "ExponentPushToken[a]")
        _token(s, PushOwnerKind.member, b, "ExponentPushToken[b]")
        s.commit()
    r = client.request(
        "DELETE",
        "/api/v1/notifications/register-token",
        json={"expo_push_token": "ExponentPushToken[b]"},
        headers=member_auth(a),
    )
    assert r.status_code == 200 and r.json()["status"] == "ok"
    r = client.request(
        "DELETE",
        "/api/v1/notifications/register-token",
        json={"expo_push_token": "ExponentPushToken[a]"},
        headers=member_auth(a),
    )
    assert r.status_code == 200
    with TestSession() as s:
        assert [t.expo_push_token for t in s.scalars(select(PushToken)).all()] == [
            "ExponentPushToken[b]"
        ]


# --- send path -------------------------------------------------------------------


def _seed_pair(s, *, token_kind: PushOwnerKind, paused=False):
    uid, lid = _user(s, "Quiet Cove"), _listener(s, name="Open River")
    cid = _convo(s, uid, lid, paused=paused)
    if token_kind == PushOwnerKind.member:
        _token(s, PushOwnerKind.member, uid, "ExponentPushToken[member]")
    else:
        _token(s, PushOwnerKind.listener, lid, "ExponentPushToken[listener]")
    s.commit()
    return uid, lid, cid


def test_member_message_pushes_the_listener_with_member_persona(sent):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=uid)
    assert len(sent) == 1
    msg = sent[0]
    assert msg["to"] == "ExponentPushToken[listener]"
    assert msg["title"] == "Mento" and msg["body"] == "Quiet Cove sent a message"
    assert msg["sound"] is None
    assert msg["data"] == {
        "kind": "message",
        "conversation_id": cid,
        "stream_channel_id": f"ch-{uid[:8]}",
    }
    assert "text" not in msg["data"]


def test_listener_message_pushes_the_member_with_listener_persona(sent):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.member)
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=lid)
    assert len(sent) == 1 and sent[0]["body"] == "Open River replied"


@pytest.mark.parametrize(
    "reason", ["no_token", "suspended", "ended", "watching", "paused", "burst"]
)
def test_message_suppression_rules(sent, monkeypatch, reason):
    with TestSession() as s:
        uid, lid = _user(s, "Quiet Cove"), _listener(s, name="Open River")
        cid = _convo(s, uid, lid, paused=(reason == "paused"))
        if reason != "no_token":
            _token(s, PushOwnerKind.listener, lid, "ExponentPushToken[listener]")
            _token(s, PushOwnerKind.member, uid, "ExponentPushToken[member]")
        if reason == "suspended":
            s.get(ListenerProfile, lid).vetting_status = VettingStatus.suspended
        if reason == "ended":
            s.get(Conversation, cid).status = ConversationStatus.ended
        s.commit()
    if reason == "watching":
        monkeypatch.setattr(push, "_is_watching", lambda channel_id, user_id: True)
    sender = (
        lid if reason == "paused" else uid
    )  # paused: the LISTENER writes, member must not be pushed
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=sender)
        if reason == "burst":
            push.notify_message(s, conversation_id=cid, sender_stream_user_id=sender)
    if reason == "burst":
        assert len(sent) == 1
    else:
        assert sent == []


def test_burst_window_resets(sent, monkeypatch):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=uid)
        ratelimit._redis().delete(*ratelimit._redis().keys("push:burst:*") or ["push:burst:none"])
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=uid)
    assert len(sent) == 2


def test_self_echo_never_pushes_and_unknown_channel_is_ignored(sent):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id="someone-else")
        push.notify_message(s, conversation_id="nope", sender_stream_user_id=uid)
    assert sent == []


def test_accepted_pushes_member_even_when_paused(sent):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.member, paused=True)
        req = ConversationRequest(requester_id=uid, target_listener_id=lid, conversation_id=cid)
        s.add(req)
        s.commit()
        rid = req.id
    with TestSession() as s:
        push.notify_request_accepted(s, request_id=rid)
    assert len(sent) == 1
    assert sent[0]["body"] == "Open River is ready to talk"
    assert sent[0]["data"]["kind"] == "accepted" and sent[0]["data"]["conversation_id"] == cid


def test_request_created_pushes_listener_without_requester_persona(sent):
    with TestSession() as s:
        uid, lid = _user(s, "Quiet Cove"), _listener(s)
        _token(s, PushOwnerKind.listener, lid, "ExponentPushToken[listener]")
        req = ConversationRequest(requester_id=uid, target_listener_id=lid)
        s.add(req)
        s.commit()
        rid = req.id
    with TestSession() as s:
        push.notify_request_created(s, request_id=rid)
    assert len(sent) == 1
    assert sent[0]["body"] == "Someone would like to talk with you"
    assert "Quiet Cove" not in sent[0]["body"]
    assert sent[0]["data"] == {"kind": "request", "request_id": rid}


def test_device_not_registered_deletes_token(monkeypatch):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
    monkeypatch.setattr(push, "ENABLED", True)
    monkeypatch.setattr(push, "_is_watching", lambda c, u: False)
    monkeypatch.setattr(
        push,
        "_post_expo",
        lambda msgs: [
            {"status": "error", "details": {"error": "DeviceNotRegistered"}} for _ in msgs
        ],
    )
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=uid)
    with TestSession() as s:
        assert s.scalars(select(PushToken)).all() == []


def test_network_error_retried_once_then_dropped(monkeypatch):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
    attempts = {"n": 0}

    def flaky(msgs):
        attempts["n"] += 1
        raise push.httpx.ConnectError("boom")

    monkeypatch.setattr(push, "ENABLED", True)
    monkeypatch.setattr(push, "_is_watching", lambda c, u: False)
    monkeypatch.setattr(push, "_post_expo", flaky)
    monkeypatch.setattr(push.time, "sleep", lambda s: None)
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=uid)  # must not raise
    assert attempts["n"] == 2


def test_disabled_sends_nothing(monkeypatch):
    calls = []
    monkeypatch.setattr(push, "_post_expo", lambda m: calls.extend(m) or [])
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
    with TestSession() as s:
        push.notify_message(
            s, conversation_id=cid, sender_stream_user_id=uid
        )  # ENABLED is False via conftest
    assert calls == []


# --- triggers --------------------------------------------------------------------


def test_create_request_endpoint_pushes_target_listener(client, sent):
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        _token(s, PushOwnerKind.listener, lid, "ExponentPushToken[listener]")
        s.commit()
    r = client.post(
        f"/api/v1/listeners/{lid}/request",
        json={"intro_message": "hi", "issue_category": None},
        headers=member_auth(uid),
    )
    assert r.status_code == 200, r.text
    assert len(sent) == 1 and sent[0]["data"]["kind"] == "request"
    # Idempotent re-post (existing pending) must NOT push again.
    client.post(
        f"/api/v1/listeners/{lid}/request",
        json={"intro_message": "hi", "issue_category": None},
        headers=member_auth(uid),
    )
    assert len(sent) == 1


def test_console_accept_pushes_requester(client, sent):
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        _token(s, PushOwnerKind.member, uid, "ExponentPushToken[member]")
        req = ConversationRequest(requester_id=uid, target_listener_id=lid)
        s.add(req)
        s.commit()
        rid = req.id
    r = client.post(f"/api/v1/listener/me/requests/{rid}/accept", headers=listener_auth(lid))
    assert r.status_code == 200, r.text
    assert len(sent) == 1 and sent[0]["data"]["kind"] == "accepted"


def test_admin_accept_pushes_requester(client, sent):
    from app.models.admin import AdminAccount
    from app.models.enums import AdminRole
    from app.security import issue_admin_token

    with TestSession() as s:
        s.execute(text("TRUNCATE admin_accounts, admin_audit_log CASCADE"))
        a = AdminAccount(name="Founder", role=AdminRole.owner)
        s.add(a)
        s.flush()
        admin_id = a.id
        uid, lid = _user(s), _listener(s)
        _token(s, PushOwnerKind.member, uid, "ExponentPushToken[member]")
        req = ConversationRequest(requester_id=uid, target_listener_id=lid)
        s.add(req)
        s.commit()
        rid = req.id
    r = client.post(
        f"/api/v1/listeners/requests/{rid}/accept",
        headers={"Authorization": f"Bearer {issue_admin_token(admin_id)}"},
    )
    assert r.status_code == 200, r.text
    assert len(sent) == 1 and sent[0]["data"]["kind"] == "accepted"


def test_message_new_webhook_schedules_push_and_never_depends_on_it(client, sent, monkeypatch):
    """The async webhook pushes the other party; a push failure changes neither the 200 nor the scan."""
    from app.routers import stream_hooks

    monkeypatch.setattr(stream, "verify_webhook", lambda body, sig: True)
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
        channel = s.get(Conversation, cid).stream_channel_id
    event = {
        "type": "message.new",
        "message": {"id": "m1", "text": "hello", "user": {"id": uid}},
        "channel": {"id": channel},
    }
    r = client.post("/api/v1/stream/webhook", json=event)
    assert r.status_code == 200
    assert len(sent) == 1 and sent[0]["body"] == "Quiet Cove sent a message"

    def explode(*a, **k):
        raise RuntimeError("push exploded")

    monkeypatch.setattr(stream_hooks.push, "notify_message", explode)
    r = client.post(
        "/api/v1/stream/webhook", json={**event, "message": {**event["message"], "id": "m2"}}
    )
    assert r.status_code == 200


# --- watcher query contract --------------------------------------------------------


def test_is_watching_requests_state_and_reads_watchers(monkeypatch):
    """Stream returns `watchers` only when `state` is requested (live-API finding,
    session 31f). Guard the exact query options so the rule can't silently die."""
    seen: dict = {}

    class _Channel:
        def query(self, **options):
            seen.update(options)
            return {"watchers": [{"id": "listener-1"}, {"id": "member-1"}], "watcher_count": 2}

    class _Client:
        def channel(self, kind, cid):
            seen["kind"], seen["cid"] = kind, cid
            return _Channel()

    monkeypatch.setattr(stream, "_client", lambda: _Client())
    monkeypatch.setattr(
        ratelimit, "_redis", lambda: (_ for _ in ()).throw(RuntimeError("no redis"))
    )
    assert push._is_watching("ch-1", "listener-1") is True
    assert push._is_watching("ch-1", "someone-else") is False
    assert seen["state"] is True and seen["watchers"] == {"limit": 100} and seen["cid"] == "ch-1"


def test_listener_delete_removes_only_own_listener_row(client):
    with TestSession() as s:
        uid, lid, other = _user(s), _listener(s), _listener(s, name="Still Pine")
        _token(s, PushOwnerKind.member, uid, "ExponentPushToken[dev]")
        _token(s, PushOwnerKind.listener, lid, "ExponentPushToken[dev]")
        s.commit()
    # Another listener cannot remove it.
    r = client.request(
        "DELETE",
        "/api/v1/listener/me/push-token",
        json={"expo_push_token": "ExponentPushToken[dev]"},
        headers=listener_auth(other),
    )
    assert r.status_code == 200
    with TestSession() as s:
        assert {t.owner_kind for t in s.scalars(select(PushToken)).all()} == {
            PushOwnerKind.member,
            PushOwnerKind.listener,
        }
    # The owner can; the member row is untouched.
    r = client.request(
        "DELETE",
        "/api/v1/listener/me/push-token",
        json={"expo_push_token": "ExponentPushToken[dev]"},
        headers=listener_auth(lid),
    )
    assert r.status_code == 200 and r.json()["status"] == "ok"
    with TestSession() as s:
        assert [t.owner_kind for t in s.scalars(select(PushToken)).all()] == [PushOwnerKind.member]
