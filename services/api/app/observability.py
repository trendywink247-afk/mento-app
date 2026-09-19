"""Logging and error reporting — with one rule above all: nothing a member wrote, and
no secret, ever leaves through a log line or a Sentry event (T&S #6 / #10).

- Log lines carry ids, route paths, status codes and exception *types* — never
  bodies, query strings or tokens.
- `httpx` logs every outbound URL at INFO; third-party URLs can carry keys, so those
  loggers are held at WARNING.
- Sentry is errors-only, without request bodies and **without frame locals**: when the
  crisis scan or the PII redaction raises, the message text is a local variable.
"""

from __future__ import annotations

import logging

from app.config import Settings

_SENSITIVE_HEADERS = {"authorization", "cookie", "x-signature", "x-api-key"}
_NOISY_HTTP_LOGGERS = ("httpx", "httpcore")


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    for name in _NOISY_HTTP_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)


def scrub_event(event: dict, _hint: dict) -> dict:
    """Sentry `before_send`: drop everything that could hold content or credentials.
    URL + method + status + stack are enough to debug."""
    request = event.get("request")
    if isinstance(request, dict):
        for key in ("data", "body", "query_string", "cookies"):
            request.pop(key, None)
        headers = request.get("headers")
        if isinstance(headers, dict):
            request["headers"] = {
                k: v for k, v in headers.items() if k.lower() not in _SENSITIVE_HEADERS
            }
    return event


def sentry_options(settings: Settings) -> dict:
    return {
        "dsn": settings.sentry_dsn,
        "environment": settings.env,
        "send_default_pii": False,
        "traces_sample_rate": 0.0,  # errors only — no performance tracing
        "include_local_variables": False,
        "max_request_body_size": "never",
        "before_send": scrub_event,
    }


def init_sentry(settings: Settings) -> None:
    """No-op without a DSN (dev default)."""
    if not settings.sentry_dsn:
        return
    import sentry_sdk

    sentry_sdk.init(**sentry_options(settings))
