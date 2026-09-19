"""The before-send hook must never lose the helpline card to an infrastructure fault.

Stream fails OPEN on a non-2xx from us: the message is delivered exactly as sent.
So a 500 on a crisis message means the member sees no Tele-MANAS / KIRAN card
(audit F1). The lexical scan needs no database; only the flag write does — and the
retried async `message.new` webhook persists whatever the sync hook could not.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.main import app
from app.routers import stream_hooks
from app.services import stream

BEFORE = "/api/v1/stream/before-message-send"
PUSH = "/api/v1/stream/webhook"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(stream, "verify_webhook", lambda body, sig: True)
    return TestClient(app, raise_server_exceptions=False)


def _db_down(*_args, **_kwargs):
    raise OperationalError("SELECT 1", {}, Exception("connection refused"))


def test_crisis_card_survives_a_database_outage(client, monkeypatch):
    monkeypatch.setattr(stream_hooks, "SessionLocal", _db_down)
    r = client.post(
        BEFORE,
        json={"message": {"id": "res-1", "text": "I want to die"}, "user": {"id": "u-1"}},
    )
    assert r.status_code == 200
    crisis = r.json()["message"]["crisis"]
    assert crisis["signal"] == "suicidal"
    assert any(h["number"] == "14416" for h in crisis["helplines"])
    assert r.json()["message"]["text"] == "I want to die"


def test_ordinary_message_never_touches_the_database(client, monkeypatch):
    """The hottest path in the product: a clean message is a regex pass, nothing more."""
    monkeypatch.setattr(stream_hooks, "SessionLocal", _db_down)
    r = client.post(BEFORE, json={"message": {"id": "res-2", "text": "thanks, that helped"}})
    assert r.status_code == 200
    assert r.json() == {}


def test_async_net_still_fails_loudly_so_stream_retries(client, monkeypatch):
    """The async hook is the persistence safety net — it must NOT swallow a flag-write
    failure, or Stream would never retry and the human queue would miss the flag."""
    monkeypatch.setattr(stream_hooks, "SessionLocal", _db_down)
    r = client.post(
        PUSH,
        json={
            "type": "message.new",
            "message": {"id": "res-3", "text": "I want to die", "user": {"id": "u-1"}},
        },
    )
    assert r.status_code == 500


def test_malformed_signed_body_is_a_400_not_a_500(client):
    r = client.post(BEFORE, content=b"not json", headers={"content-type": "application/json"})
    assert r.status_code == 400
