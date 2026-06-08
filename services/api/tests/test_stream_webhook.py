"""The Stream before-message-send webhook is the crisis-scan enforcement point.

These tests cover the handler logic offline (no live Stream): an unverified request is
rejected; a crisis message is flagged server-side and the response carries the helpline
payload; a benign message passes through untouched; and the same message id never
double-flags (sync hook + async safety net dedupe).
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models.safety import SafetyFlag
from app.services import stream

from .conftest import TestSession, requires_postgres

BEFORE = "/api/v1/stream/before-message-send"
PUSH = "/api/v1/stream/webhook"


@pytest.fixture
def client():
    return TestClient(app)


def _flag_count(stream_message_id: str) -> int:
    with TestSession() as s:
        return s.execute(
            select(func.count())
            .select_from(SafetyFlag)
            .where(SafetyFlag.stream_message_id == stream_message_id)
        ).scalar_one()


@requires_postgres
def test_unverified_request_is_rejected(client, db_session, monkeypatch):
    # Signature can't be verified (stub/forged) → 401, and nothing is processed.
    monkeypatch.setattr(stream, "verify_webhook", lambda body, sig: False)
    r = client.post(BEFORE, json={"message": {"id": "m1", "text": "I want to die"}})
    assert r.status_code == 401
    assert _flag_count("m1") == 0


@requires_postgres
def test_crisis_message_is_flagged_and_augmented(client, db_session, monkeypatch):
    monkeypatch.setattr(stream, "verify_webhook", lambda body, sig: True)
    r = client.post(
        BEFORE,
        json={
            "message": {"id": "m2", "text": "honestly I want to die"},
            "user": {"id": "u-123"},
        },
    )
    assert r.status_code == 200
    crisis = r.json()["message"]["crisis"]
    assert crisis["signal"] == "suicidal"
    assert crisis["support"]
    assert any(h["number"] == "14416" for h in crisis["helplines"])  # Tele-MANAS
    # Text echoed back so partial-update semantics can't drop the body.
    assert r.json()["message"]["text"] == "honestly I want to die"
    # Flagged server-side, signal only.
    with TestSession() as s:
        flag = s.execute(
            select(SafetyFlag).where(SafetyFlag.stream_message_id == "m2")
        ).scalar_one()
    assert flag.signal.value == "suicidal"
    assert flag.user_id == "u-123"


@requires_postgres
def test_benign_message_passes_through(client, db_session, monkeypatch):
    monkeypatch.setattr(stream, "verify_webhook", lambda body, sig: True)
    r = client.post(
        BEFORE, json={"message": {"id": "m3", "text": "thanks, that helped a lot"}}
    )
    assert r.status_code == 200
    assert r.json() == {}  # allowed unchanged
    assert _flag_count("m3") == 0


@requires_postgres
def test_same_message_is_not_double_flagged(client, db_session, monkeypatch):
    # The sync before-send hook and the async message.new safety net can both see the
    # same message id; it must be flagged exactly once.
    monkeypatch.setattr(stream, "verify_webhook", lambda body, sig: True)
    msg = {"message": {"id": "m4", "text": "I want to die"}, "user": {"id": "u-9"}}
    assert client.post(BEFORE, json=msg).status_code == 200
    push = {"type": "message.new", "message": {"id": "m4", "text": "I want to die", "user": {"id": "u-9"}}}
    assert client.post(PUSH, json=push).status_code == 200
    assert _flag_count("m4") == 1
