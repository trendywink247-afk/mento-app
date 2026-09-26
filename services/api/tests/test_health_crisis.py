"""The /health/crisis staleness probe — active alerting for the fail-open scan.

Unit tests with monkeypatched Redis/stream state; no live services needed.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import stream


@pytest.fixture
def client():
    return TestClient(app)


class _FakeRedis:
    def __init__(self, value: str | None):
        self._value = value

    def get(self, key: str) -> str | None:
        return self._value


def _patch(monkeypatch, *, configured: bool, last: str | None | Exception):
    monkeypatch.setattr(stream, "is_configured", lambda: configured)
    from app import ratelimit

    if isinstance(last, Exception):

        def boom():
            raise last

        monkeypatch.setattr(ratelimit, "_redis", boom)
    else:
        monkeypatch.setattr(ratelimit, "_redis", lambda: _FakeRedis(last))


def test_stub_mode_is_ok(client, monkeypatch):
    _patch(monkeypatch, configured=False, last=None)
    r = client.get("/api/v1/health/crisis")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_recent_webhook_is_ok(client, monkeypatch):
    now = datetime.now(UTC).isoformat()
    _patch(monkeypatch, configured=True, last=now)
    r = client.get("/api/v1/health/crisis")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_stale_webhook_is_503(client, monkeypatch):
    stale = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    _patch(monkeypatch, configured=True, last=stale)
    r = client.get("/api/v1/health/crisis")
    assert r.status_code == 503
    assert r.json()["status"] == "stale"


def test_never_seen_webhook_is_503(client, monkeypatch):
    _patch(monkeypatch, configured=True, last=None)
    r = client.get("/api/v1/health/crisis")
    assert r.status_code == 503
    assert r.json()["status"] == "stale"


def test_redis_down_is_503_unknown(client, monkeypatch):
    import redis as redis_lib

    _patch(monkeypatch, configured=True, last=redis_lib.ConnectionError("redis down"))
    r = client.get("/api/v1/health/crisis")
    assert r.status_code == 503
    assert r.json()["status"] == "unknown"


def test_malformed_stamp_is_degraded_not_500(client, monkeypatch):
    # A7: a corrupted Redis value must degrade the probe, never 500 it.
    _patch(monkeypatch, configured=True, last="not-a-timestamp")
    r = client.get("/api/v1/health/crisis")
    assert r.status_code == 503
    assert r.json()["status"] == "degraded"


# --- /status/public: the public status page's only allowed data source --------


def test_public_status_always_200_even_when_crisis_stale(client, monkeypatch):
    stale = (datetime.now(UTC) - timedelta(hours=2)).isoformat()
    _patch(monkeypatch, configured=True, last=stale)
    r = client.get("/api/v1/status/public")
    assert r.status_code == 200
    body = r.json()
    assert body["crisis_safety_net"] == "stale"
    assert body["api"] == "healthy"


def test_public_status_is_cors_open(client, monkeypatch):
    # The status page lives on a different origin (status.mento.chat) and fetches
    # this route directly from the browser — it needs its own CORS header,
    # independent of the app's normal CORS_ORIGINS allowlist.
    _patch(monkeypatch, configured=False, last=None)
    r = client.get("/api/v1/status/public")
    assert r.headers.get("access-control-allow-origin") == "*"


def test_public_status_shape_has_no_pii_or_crisis_counts(client, monkeypatch):
    _patch(monkeypatch, configured=False, last=None)
    r = client.get("/api/v1/status/public")
    body = r.json()
    allowed = {
        "api",
        "database",
        "crisis_safety_net",
        "members_total",
        "mentors_online",
        "conversations_active",
    }
    # A public page's data source is a promise: nothing beyond this fixed shape
    # ever leaks in without a deliberate code change and a fresh look at T&S.
    assert set(body.keys()) == allowed
    assert isinstance(body["members_total"], int)
    assert isinstance(body["mentors_online"], int)
    assert isinstance(body["conversations_active"], int)
