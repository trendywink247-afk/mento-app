"""Double taps and client retries (audit F11/F13): every write below is a
check-then-insert. Hammered from a barrier, each must answer 200 every time and leave
exactly ONE row — not a 500 from a unique index, not a duplicate."""

from __future__ import annotations

import threading
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, PushOwnerKind, VettingStatus
from app.models.journal import JournalEntry
from app.models.listener import ListenerProfile
from app.models.push_token import PushToken
from app.models.reflection import ConversationReflection
from app.models.request import ConversationRequest
from app.models.user import User
from app.security import issue_session_token
from app.services import push, stream

from .conftest import TestSession, requires_postgres

N = 12


@pytest.fixture
def client():
    return TestClient(app, raise_server_exceptions=False)


def _seed(s) -> tuple[str, str, str]:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=1,
        max_concurrent=3,
    )
    s.add_all([u, li])
    s.flush()
    c = Conversation(
        type="anon",
        status=ConversationStatus.active,
        user_id=u.id,
        listener_id=li.id,
        stream_channel_id=f"ch-{uuid.uuid4().hex[:8]}",
    )
    s.add(c)
    s.flush()
    return u.id, li.id, c.id


def _auth(uid: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _hammer(fn) -> list:
    barrier = threading.Barrier(N)
    out: list = []
    lock = threading.Lock()

    def worker() -> None:
        barrier.wait()
        try:
            result = fn()
        except Exception as exc:  # noqa: BLE001 — a raise IS the failure being tested
            result = type(exc).__name__
        with lock:
            out.append(result)

    threads = [threading.Thread(target=worker) for _ in range(N)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    return out


@requires_postgres
def test_reflection_double_submit(client, db_session):
    with TestSession() as s:
        uid, _, cid = _seed(s)
        s.commit()
    statuses = _hammer(
        lambda: client.post(
            f"/api/v1/conversations/{cid}/reflection", json={"energy": 4}, headers=_auth(uid)
        ).status_code
    )
    assert statuses == [200] * N
    with TestSession() as s:
        assert s.query(ConversationReflection).filter_by(conversation_id=cid).count() == 1


@requires_postgres
def test_push_token_double_register(db_session):
    with TestSession() as s:
        uid, _, _ = _seed(s)
        s.commit()
    token = f"ExponentPushToken[{uuid.uuid4().hex}]"

    def register() -> str:
        with TestSession() as s:
            push.upsert_token(s, PushOwnerKind.member, uid, token, "android")
        return "ok"

    assert _hammer(register) == ["ok"] * N
    with TestSession() as s:
        assert s.query(PushToken).filter_by(expo_push_token=token).count() == 1


@requires_postgres
def test_mentor_note_double_long_press(client, db_session):
    with TestSession() as s:
        uid, _, cid = _seed(s)
        s.commit()
    message_id = f"msg-{uuid.uuid4().hex}"
    body = {"body": "Take it one paper at a time.", "conversation_id": cid}
    statuses = _hammer(
        lambda: client.post(
            "/api/v1/journals/mentor-notes",
            json={**body, "stream_message_id": message_id},
            headers=_auth(uid),
        ).status_code
    )
    assert statuses == [200] * N
    with TestSession() as s:
        assert s.query(JournalEntry).filter_by(user_id=uid).count() == 1


@requires_postgres
def test_personal_request_double_send(client, db_session):
    with TestSession() as s:
        uid, lid, _ = _seed(s)
        s.commit()
    responses = _hammer(
        lambda: client.post(
            f"/api/v1/listeners/{lid}/request",
            json={"intro_message": "Could we talk about mains?"},
            headers=_auth(uid),
        ).json()["id"]
    )
    assert len(set(responses)) == 1  # every caller got the SAME request back
    with TestSession() as s:
        assert s.query(ConversationRequest).filter_by(requester_id=uid).count() == 1


@requires_postgres
def test_onboarding_leaves_no_orphan_when_stream_is_down(client, db_session, monkeypatch):
    def _down(*_a, **_k):
        raise ConnectionError("stream unreachable")

    monkeypatch.setattr(stream, "upsert_user", _down)
    r = client.post("/api/v1/onboarding/start", json={"dob": "1996-01-01"})
    assert r.status_code == 503
    assert "try again" in r.json()["detail"].lower()
    with TestSession() as s:
        assert s.query(User).count() == 0
