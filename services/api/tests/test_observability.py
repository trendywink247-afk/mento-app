"""Nothing secret or member-written may leave through logs or Sentry (audit F2, T&S #10)."""

from __future__ import annotations

import json
import logging

import pytest

from app import observability
from app.config import Settings
from app.services import notes_ai


class _Resp:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        text = json.dumps({"overview": "ok", "themes": []})
        return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def test_gemini_key_travels_in_a_header_never_in_the_url(monkeypatch):
    """httpx logs every request URL at INFO and Sentry breadcrumbs keep it — a
    `?key=` query string is a secret in the container log."""
    seen: dict = {}

    def fake_post(url, **kwargs):
        seen["url"] = url
        seen.update(kwargs)
        return _Resp()

    monkeypatch.setattr(notes_ai.httpx, "post", fake_post)
    monkeypatch.setattr(
        notes_ai, "get_settings", lambda: Settings(gemini_api_key="sk-secret-123", _env_file=None)
    )
    notes_ai.organize(["one", "two"])
    assert "sk-secret-123" not in seen["url"]
    assert "key" not in (seen.get("params") or {})
    assert seen["headers"]["x-goog-api-key"] == "sk-secret-123"


def _settings(**kw) -> Settings:
    return Settings(sentry_dsn="https://k@o.example/1", _env_file=None, **kw)


def test_sentry_never_captures_frame_locals_or_bodies():
    opts = observability.sentry_options(_settings(env="production"))
    # Frame locals are where message text lives when the scan or redaction raises.
    assert opts["include_local_variables"] is False
    assert opts["include_source_context"] is False
    assert opts["max_request_body_size"] == "never"
    assert opts["max_breadcrumbs"] == 0
    assert opts["send_default_pii"] is False
    assert opts["traces_sample_rate"] == 0.0
    assert opts["profiles_sample_rate"] == 0.0
    assert opts["before_send"] is observability.scrub_event
    assert opts["before_breadcrumb"]({"message": "x"}, {}) is None
    assert opts["before_send_transaction"]({"type": "transaction"}, {}) is None


@pytest.mark.parametrize(
    ("env", "expected"),
    [
        ("qa", "qa"),
        ("staging", "qa"),
        ("production", "production"),
        ("prod", "production"),
        ("PROD", "production"),
        ("QA", "qa"),
    ],
)
def test_sentry_environment_mapping(env, expected):
    assert observability.sentry_options(_settings(env=env))["environment"] == expected


@pytest.mark.parametrize("env", ["dev", "", "test", "prodution", "produc"])
def test_sentry_stays_off_for_any_other_env(env):
    assert observability.sentry_options(_settings(env=env)) is None


def test_sentry_stays_off_without_a_dsn():
    assert observability.sentry_options(Settings(env="qa", _env_file=None)) is None


def test_sentry_release_is_the_git_sha_or_absent():
    assert (
        observability.sentry_options(_settings(env="qa", git_sha="abc123"))["release"] == "abc123"
    )
    assert "release" not in observability.sentry_options(_settings(env="qa"))


MEMBER_TEXT = "i have been feeling hopeless since monday"


def _loaded_event() -> dict:
    """An event stuffed with member text and identifiers in every place the SDK or app
    could put them."""
    return {
        "event_id": "e1",
        "level": "error",
        "release": "abc123",
        "environment": "qa",
        "message": MEMBER_TEXT,
        "logentry": {"message": "bad %s", "params": [MEMBER_TEXT]},
        "fingerprint": [MEMBER_TEXT],
        "transaction": "/api/v1/conversations/{convo_id}/messages",
        "exception": {
            "values": [
                {
                    "type": "ValueError",
                    "value": f"invalid message: {MEMBER_TEXT}",
                    "mechanism": {"type": "asgi", "handled": False, "data": MEMBER_TEXT},
                    "stacktrace": {
                        "frames": [
                            {
                                "filename": "app/services/chat.py",
                                "function": "send",
                                "lineno": 42,
                                "in_app": True,
                                "vars": {"text": MEMBER_TEXT},
                                "context_line": f'raise ValueError("{MEMBER_TEXT}")',
                                "pre_context": [MEMBER_TEXT],
                                "post_context": [MEMBER_TEXT],
                            }
                        ]
                    },
                }
            ]
        },
        "breadcrumbs": {"values": [{"message": MEMBER_TEXT}]},
        "extra": {"body": MEMBER_TEXT},
        "user": {"id": "u1", "ip_address": "203.0.113.9", "username": "someone"},
        "tags": {"request_id": "r1", "free_text": MEMBER_TEXT},
        "contexts": {"runtime": {"name": "CPython"}, "custom": {"text": MEMBER_TEXT}},
        "_meta": {"message": {"": {"rem": [["x", "s", 0, 1]], "val": MEMBER_TEXT}}},
        "request": {
            "method": "POST",
            "url": "https://qa-api.mento.chat/api/v1/conversations/1/messages?token=abc",
            "data": {"text": MEMBER_TEXT},
            "body": MEMBER_TEXT,
            "query_string": "token=abc",
            "cookies": {"a": "b"},
            "headers": {
                "Authorization": "Bearer x",
                "X-Forwarded-For": "203.0.113.9",
                "X-Real-IP": "203.0.113.9",
                "User-Agent": "ua",
            },
            "env": {"REMOTE_ADDR": "203.0.113.9", "SERVER_NAME": "qa-api"},
        },
    }


def test_sentry_scrub_removes_message_content_and_ips_everywhere():
    out = observability.scrub_event(_loaded_event(), {})
    blob = json.dumps(out)
    assert MEMBER_TEXT not in blob
    assert "hopeless" not in blob
    assert "203.0.113.9" not in blob
    assert "Bearer" not in blob and "token=abc" not in blob
    for gone in ("breadcrumbs", "extra", "user", "_meta", "fingerprint", "message"):
        assert gone not in out
    req = out["request"]
    assert set(req) == {"method", "url"}
    assert req["url"] == "https://qa-api.mento.chat/api/v1/conversations/{id}/messages"


def test_sentry_scrub_keeps_what_debugging_needs():
    out = observability.scrub_event(_loaded_event(), {})
    assert out["release"] == "abc123" and out["environment"] == "qa"
    assert out["transaction"] == "/api/v1/conversations/{convo_id}/messages"
    exc = out["exception"]["values"][0]
    assert exc["type"] == "ValueError" and exc["value"] == observability.SCRUBBED
    assert exc["mechanism"] == {"type": "asgi", "handled": False}
    assert exc["stacktrace"]["frames"] == [
        {"filename": "app/services/chat.py", "function": "send", "lineno": 42, "in_app": True}
    ]
    assert out["tags"] == {"request_id": "r1"}
    assert out["contexts"] == {"runtime": {"name": "CPython"}}
    assert out["logentry"] == {"message": observability.SCRUBBED}


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (
            "https://h.example/api/v1/conversations/123/messages",
            "https://h.example/api/v1/conversations/{id}/messages",
        ),
        (
            "https://h.example/api/v1/users/3f2b8c1e-9a4d-4e0b-8f6a-1c2d3e4f5a6b/notes",
            "https://h.example/api/v1/users/{id}/notes",
        ),
        (
            "https://h.example/api/v1/s/0123456789abcdef0123456789abcdef",
            "https://h.example/api/v1/s/{id}",
        ),
        (
            "https://h.example/api/v1/s/507F1F77BCF86CD799439011/x",
            "https://h.example/api/v1/s/{id}/x",
        ),
        ("https://h.example/api/v1/health", "https://h.example/api/v1/health"),
        ("https://h.example/api/v1/feed/facade", "https://h.example/api/v1/feed/facade"),
        ("https://u:pw@h.example:8443/a/7?token=abc#frag", "https://h.example:8443/a/{id}"),
        ("/api/v1/conversations/42", "/api/v1/conversations/{id}"),
    ],
)
def test_sentry_scrub_replaces_id_path_segments(url, expected):
    out = observability.scrub_event({"request": {"method": "GET", "url": url}}, {})
    assert out["request"]["url"] == expected


def test_sentry_scrub_fails_closed(monkeypatch):
    def boom(_event):
        raise RuntimeError("scrubber bug")

    monkeypatch.setattr(observability, "_scrub", boom)
    assert observability.scrub_event(_loaded_event(), {}) is None


def test_init_sentry_is_a_no_op_when_off(monkeypatch):
    import sentry_sdk

    called = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **kw: called.append(kw))
    observability.init_sentry(_settings(env="dev"))
    assert called == []
    observability.init_sentry(_settings(env="qa"))
    assert len(called) == 1 and called[0]["environment"] == "qa"


def test_http_client_loggers_are_quiet_at_info():
    observability.configure_logging()
    assert logging.getLogger("httpx").level >= logging.WARNING
    assert logging.getLogger("httpcore").level >= logging.WARNING
