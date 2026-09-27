"""T3.11 — the signup limiter fails CLOSED when Redis is down; chat does not.

Onboarding is the one unauthenticated endpoint that creates a real account (and a
Stream user) per call: with the limiter blind, a loop could mint unbounded accounts.
So a Redis outage turns signup into an honest 503. Everything a member already in a
conversation needs — above all sending a message — keeps failing OPEN."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import redis as redis_lib
from fastapi.testclient import TestClient

from app import ratelimit
from app.main import app
from app.services import stream

from .conftest import requires_postgres


class _RedisDown:
    def pipeline(self):
        raise redis_lib.ConnectionError("redis down")

    def __getattr__(self, name):
        def _boom(*a, **k):
            raise redis_lib.ConnectionError("redis down")

        return _boom


@pytest.fixture
def redis_down(monkeypatch):
    monkeypatch.setattr(ratelimit, "_redis", lambda: _RedisDown())
    monkeypatch.setattr(stream, "upsert_user", lambda *a, **k: None)
    ratelimit.ENABLED = True
    yield
    ratelimit.ENABLED = False


@pytest.fixture
def client():
    return TestClient(app)


def _adult() -> str:
    return (datetime.now(UTC).date() - timedelta(days=30 * 366)).isoformat()


@requires_postgres
def test_signup_is_503_when_the_limiter_is_blind(client, db_session, redis_down):
    resp = client.post("/api/v1/onboarding/start", json={"dob": _adult()})
    assert resp.status_code == 503


@requires_postgres
def test_chat_sends_still_flow_when_redis_is_down(client, db_session, redis_down, monkeypatch):
    monkeypatch.setattr(stream, "verify_webhook", lambda body, sig: True)
    resp = client.post(
        "/api/v1/stream/before-message-send",
        json={"message": {"id": "m-redis-down", "text": "thanks, that helped"}},
    )
    assert resp.status_code == 200
    assert resp.json() == {}


def test_by_ip_defaults_to_failing_open(monkeypatch):
    monkeypatch.setattr(ratelimit, "_redis", lambda: _RedisDown())
    ratelimit.ENABLED = True
    try:
        dep = ratelimit.by_ip("probe-open", 1, 60, detail="x")
        from types import SimpleNamespace

        dep(SimpleNamespace(headers={}, client=SimpleNamespace(host="10.0.0.1")))  # no raise
    finally:
        ratelimit.ENABLED = False
