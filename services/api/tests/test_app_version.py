"""X-App-Version gate: 426 below MIN_APP_VERSION, with crisis/safety paths always exempt."""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import app_version
from app.app_version import MinAppVersionMiddleware, is_exempt, parse_version
from app.config import get_settings

# Every path an outdated app needs to reach crisis help. If this list shrinks, that is
# a Trust & Safety change.
MUST_PASS = [
    "/api/v1/health",
    "/api/v1/health/ready",
    "/api/v1/health/crisis",
    "/api/v1/status/public",
    "/api/v1/stream/before-message-send",
    "/api/v1/stream/webhook",
    "/api/v1/safety/scan",
    "/api/v1/feedback",
    "/api/v1/conversations/abc123/report",
    "/api/v1/conversations/abc123/block",
    "/api/v1/listener/me/conversations/abc123/report",
    # A member on an old build can always end a chat and erase their data...
    "/api/v1/conversations/abc123/end",
    "/api/v1/conversations/abc123/wipe",
    "/api/v1/chat/abc123/wipe",
    # ...and get (back) a session to do it with.
    "/api/v1/auth/refresh",
    "/api/v1/onboarding/recover",
]
GATED = [
    "/api/v1/me",
    "/api/v1/match/request",
    "/api/v1/chat/abc123/messages",
    "/api/v1/onboarding/start",
    "/api/v1/auth/upgrade",
    "/api/v1/conversations/abc123/verify-pin",
    "/api/v1/healthz-not-exempt",
    "/api/v1/feedback-not-exempt",
]


def _client() -> TestClient:
    app = FastAPI()
    app.add_middleware(MinAppVersionMiddleware)

    @app.api_route("/{full_path:path}", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
    def ok(full_path: str) -> dict:
        return {"ok": True}

    return TestClient(app)


@pytest.fixture
def minimum(monkeypatch):
    def set_min(value: str) -> None:
        monkeypatch.setattr(get_settings(), "min_app_version", value)

    return set_min


def test_disabled_by_default_and_when_blank(minimum):
    c = _client()
    minimum("")
    assert c.get("/api/v1/me", headers={"X-App-Version": "0.0.1"}).status_code == 200


def test_missing_header_passes(minimum):
    minimum("2.0.0")
    assert _client().get("/api/v1/me").status_code == 200


def test_old_version_gets_426_json(minimum):
    minimum("2.0.0")
    r = _client().get("/api/v1/me", headers={"X-App-Version": "1.9.9"})
    assert r.status_code == 426
    body = r.json()
    assert body["code"] == "upgrade_required"
    assert body["min_app_version"] == "2.0.0"
    assert "update" in body["detail"].lower()


@pytest.mark.parametrize("sent", ["2.0.0", "2.0", "2", "2.0.1", "10.0.0", "v2.1.0", "2.0.0-beta.1"])
def test_equal_or_newer_passes(minimum, sent):
    minimum("2.0.0")
    assert _client().get("/api/v1/me", headers={"X-App-Version": sent}).status_code == 200


@pytest.mark.parametrize("sent", ["garbage", "", "1.x", "latest"])
def test_unparseable_header_passes(minimum, sent):
    minimum("2.0.0")
    assert _client().get("/api/v1/me", headers={"X-App-Version": sent}).status_code == 200


def test_unparseable_minimum_disables_check(minimum):
    minimum("not-a-version")
    assert _client().get("/api/v1/me", headers={"X-App-Version": "0.0.1"}).status_code == 200


@pytest.mark.parametrize("path", MUST_PASS)
def test_crisis_safety_health_stream_always_pass_when_outdated(minimum, path):
    minimum("99.0.0")
    c = _client()
    assert is_exempt(path)
    assert c.get(path, headers={"X-App-Version": "0.0.1"}).status_code == 200
    assert c.post(path, headers={"X-App-Version": "0.0.1"}).status_code == 200


@pytest.mark.parametrize("path", GATED)
def test_other_paths_are_gated(minimum, path):
    minimum("99.0.0")
    assert not is_exempt(path)
    assert _client().get(path, headers={"X-App-Version": "0.0.1"}).status_code == 426


def test_paths_outside_api_and_preflight_pass(minimum):
    minimum("99.0.0")
    c = _client()
    h = {"X-App-Version": "0.0.1"}
    assert c.get("/docs", headers=h).status_code == 200
    assert c.options("/api/v1/me", headers=h).status_code == 200


def test_exempt_paths_match_real_routes():
    """Guard against the exempt list drifting from routes that actually exist."""
    from app.main import API, app

    paths = set(app.openapi()["paths"])
    for needed in [
        "/health",
        "/health/crisis",
        "/safety/scan",
        "/feedback",
        "/stream/before-message-send",
        "/stream/webhook",
        "/conversations/{convo_id}/report",
        "/conversations/{convo_id}/block",
        "/conversations/{convo_id}/end",
        "/conversations/{convo_id}/wipe",
        "/chat/{conversation_id}/wipe",
        "/auth/refresh",
        "/onboarding/recover",
        "/me",
        "/listener/me/conversations/{convo_id}/report",
    ]:
        assert API + needed in paths, needed
    for p in paths:
        if (
            p.startswith(API + "/stream")
            or p.startswith(API + "/safety")
            or p.startswith(API + "/health")
        ):
            assert is_exempt(p.replace("{", "x").replace("}", "")), p


def test_parse_version():
    assert parse_version("1.4.0") == (1, 4)
    assert parse_version("v1.4") == (1, 4)
    assert parse_version("1.4.0-rc1") == (1, 4)
    assert parse_version("x") is None
    assert app_version.parse_version(None) is None


def test_delete_me_is_exempt_but_other_me_methods_are_not(minimum):
    minimum("99.0.0")
    c = _client()
    h = {"X-App-Version": "0.0.1"}
    assert c.delete("/api/v1/me", headers=h).status_code == 200
    assert c.get("/api/v1/me", headers=h).status_code == 426
    assert c.post("/api/v1/me", headers=h).status_code == 426
    assert is_exempt("/api/v1/me", "DELETE") and not is_exempt("/api/v1/me", "GET")
