"""Nothing secret or member-written may leave through logs or Sentry (audit F2, T&S #10)."""

from __future__ import annotations

import json
import logging

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


def test_sentry_never_captures_frame_locals_or_bodies():
    opts = observability.sentry_options(Settings(sentry_dsn="https://k@o.example/1", env="prod"))
    # Frame locals are where message text lives when the scan or redaction raises.
    assert opts["include_local_variables"] is False
    assert opts["max_request_body_size"] == "never"
    assert opts["send_default_pii"] is False
    assert opts["traces_sample_rate"] == 0.0


def test_sentry_scrub_drops_body_query_and_cookies():
    event = {
        "request": {
            "url": "https://api/x",
            "data": {"text": "secret words"},
            "body": "raw",
            "query_string": "token=abc",
            "cookies": {"a": "b"},
            "headers": {"Authorization": "Bearer x", "User-Agent": "ua"},
        }
    }
    out = observability.scrub_event(event, {})
    req = out["request"]
    assert "data" not in req and "body" not in req
    assert "query_string" not in req and "cookies" not in req
    assert "Authorization" not in req["headers"]
    assert req["headers"]["User-Agent"] == "ua"


def test_http_client_loggers_are_quiet_at_info():
    observability.configure_logging()
    assert logging.getLogger("httpx").level >= logging.WARNING
    assert logging.getLogger("httpcore").level >= logging.WARNING
