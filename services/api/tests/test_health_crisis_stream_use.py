"""/health/crisis once own chat is the default (QA 2026-11-12).

A silent Stream webhook is only a symptom while Stream can still carry a message. With own
chat the default and no active Stream conversation, that silence must not page anyone; the
own-chat half decides. Anything else keeps the old alarm exactly as it was.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.config import get_settings
from app.main import app
from app.models.chat_message import ChatMessage
from app.models.conversation import Conversation
from app.routers import health
from app.services import chat, stream

from .chat_helpers import seed_chat
from .conftest import requires_postgres

pytestmark = requires_postgres

STALE = (datetime.now(UTC) - timedelta(hours=3)).isoformat()


class _FakeRedis:
    def __init__(self, value):
        self._value = value

    def get(self, key):
        return self._value if key == "mento:last_webhook_at" else None


@pytest.fixture
def stale_stream(monkeypatch):
    """Stream configured, last webhook 3 h ago."""
    from app import ratelimit

    monkeypatch.setattr(stream, "is_configured", lambda: True)
    monkeypatch.setattr(ratelimit, "_redis", lambda: _FakeRedis(STALE))


@pytest.fixture
def own_default(monkeypatch):
    monkeypatch.setattr(get_settings(), "own_chat_new_conversations", True)


def _room(s, backend: str):
    room = seed_chat(s)
    convo = s.get(Conversation, room.cid)
    convo.chat_backend = backend
    convo.stream_channel_id = room.cid if backend == "stream" else None
    s.commit()
    return room


def _crisis(client):
    r = client.get("/api/v1/health/crisis")
    return r.status_code, r.json()


def test_stale_but_unused_stream_is_ok(db_session, stale_stream, own_default):
    _room(db_session, "own")  # traffic exists, but none of it can reach Stream
    with TestClient(app) as client:
        code, body = _crisis(client)
        assert code == 200, body
        assert body["status"] == "ok"
        assert body["stream"] == "not_in_use"
        assert body["last_webhook_at"] == STALE  # still reported, just not alarming
        assert client.get("/api/v1/status/public").json()["crisis_safety_net"] == "healthy"


def test_stale_with_an_active_stream_conversation_is_stale_as_before(
    db_session, stale_stream, own_default
):
    _room(db_session, "stream")
    with TestClient(app) as client:
        code, body = _crisis(client)
    assert code == 503
    assert body["status"] == "stale"
    assert "stream" not in body
    assert body["detail"].startswith("last Stream webhook")


def test_stale_when_own_chat_is_not_the_default_is_stale_as_before(db_session, stale_stream):
    assert get_settings().own_chat_new_conversations is False
    _room(db_session, "own")
    with TestClient(app) as client:
        code, body = _crisis(client)
    assert code == 503 and body["status"] == "stale"


def test_an_ended_stream_conversation_does_not_keep_the_alarm(
    db_session, stale_stream, own_default
):
    room = _room(db_session, "stream")
    from app.models.enums import ConversationStatus

    convo = db_session.get(Conversation, room.cid)
    convo.status = ConversationStatus.ended
    db_session.commit()
    with TestClient(app) as client:
        code, body = _crisis(client)
    assert code == 200 and body["stream"] == "not_in_use"


def test_own_backlog_is_degraded_even_when_stream_is_waived(
    db_session, stale_stream, own_default, monkeypatch
):
    room = _room(db_session, "own")

    def boom(*a, **k):
        raise RuntimeError("flag write failed")

    with monkeypatch.context() as m:
        m.setattr(chat.safety, "record_flag", boom)
        sent = chat.send(db_session, room.member_id, room.cid, client_id="c1", body="i want to die")
    db_session.execute(
        update(ChatMessage)
        .where(ChatMessage.id == sent.message["id"])
        .values(created_at=datetime.now(UTC) - timedelta(minutes=20))
    )
    db_session.commit()
    with TestClient(app) as client:
        code, body = _crisis(client)
        assert code == 503
        assert body["status"] == "degraded"
        assert body["own_chat"]["unflagged_backlog"] is True
        assert client.get("/api/v1/status/public").json()["crisis_safety_net"] == "stale"


def test_database_error_is_not_ok(db_session, stale_stream, own_default, monkeypatch):
    def broken_session():
        raise RuntimeError("database down")

    monkeypatch.setattr(health, "SessionLocal", broken_session)
    # A failed in-use check counts as "in use", so the old stale rule applies.
    assert health._stream_in_use() is True
    status_body = health._crisis_status()
    assert status_body["status"] == "stale"
    assert status_body["own_chat"]["status"] == "unknown"


def test_unknown_own_check_is_not_ok_when_stream_is_waived(
    db_session, stale_stream, own_default, monkeypatch
):
    monkeypatch.setattr(health, "_stream_in_use", lambda: False)
    monkeypatch.setattr(health, "_own_chat_crisis", lambda: {"status": "unknown"})
    body = health._crisis_status()
    assert body["status"] == "unknown"
    assert body["stream"] == "not_in_use"


def test_unreachable_redis_is_never_waived(db_session, own_default, monkeypatch):
    import redis as redis_lib

    from app import ratelimit

    def boom():
        raise redis_lib.ConnectionError("down")

    monkeypatch.setattr(stream, "is_configured", lambda: True)
    monkeypatch.setattr(ratelimit, "_redis", boom)
    _room(db_session, "own")
    with TestClient(app) as client:
        code, body = _crisis(client)
    assert code == 503 and body["status"] == "unknown"
