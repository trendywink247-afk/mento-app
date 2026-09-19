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

import contextvars
import json
import logging
import re
import time
import traceback
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import Settings

_SENSITIVE_HEADERS = {"authorization", "cookie", "x-signature", "x-api-key"}
_NOISY_HTTP_LOGGERS = ("httpx", "httpcore")


class _MentoHandler(logging.StreamHandler):
    """Marker type so a re-import never installs a second handler."""


def configure_logging() -> None:
    root = logging.getLogger()
    if not any(isinstance(h, _MentoHandler) for h in root.handlers):
        handler = _MentoHandler()
        handler.addFilter(RequestIdFilter())
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s rid=%(request_id)s %(message)s")
        )
        root.addHandler(handler)
    root.setLevel(logging.INFO)
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


# --- Request context: one id per request, on every log line and every response ------

_REQUEST_ID: contextvars.ContextVar[str] = contextvars.ContextVar("mento_request_id", default="-")
_INBOUND_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
_QUIET_PATHS = {"/api/v1/health"}  # the container healthcheck hits this every 30 s

access_logger = logging.getLogger("mento.access")
error_logger = logging.getLogger("mento.errors")

GENERIC_500 = "Something went wrong on our side. Please try again in a moment."


def current_request_id() -> str:
    return _REQUEST_ID.get()


class RequestIdFilter(logging.Filter):
    """Stamps every record with the current request id so one member-reported id
    finds every line that request wrote."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = _REQUEST_ID.get()
        return True


def _report(exc: BaseException) -> None:
    """This middleware answers the 500 itself, so the error never reaches Sentry's
    outer ASGI wrapper — hand it over explicitly. No-op when Sentry is off."""
    try:
        import sentry_sdk

        sentry_sdk.capture_exception(exc)
    except Exception:  # noqa: BLE001 — reporting must never break the response
        pass


class RequestContextMiddleware:
    """Pure ASGI (BaseHTTPMiddleware breaks BackgroundTasks ordering and streaming).

    - Accepts a well-formed inbound `X-Request-ID`, otherwise mints one; returns it on
      every response and exposes it to the log filter.
    - Writes ONE access line: method, ROUTE TEMPLATE (never the raw path — ids stay
      out of logs), status, duration. Never query strings, bodies or tokens.
    - Turns an unhandled exception into a JSON 500 the app can parse. It sits INSIDE
      the CORS middleware, so a browser sees the JSON instead of an opaque CORS error.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        inbound = dict(scope.get("headers") or []).get(b"x-request-id", b"").decode("latin-1")
        request_id = inbound if _INBOUND_ID.match(inbound) else uuid.uuid4().hex
        token = _REQUEST_ID.set(request_id)
        started = time.perf_counter()
        status_code = 500
        response_started = False

        async def send_with_id(message: Message) -> None:
            nonlocal status_code, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_code = message["status"]
                headers = list(message.get("headers") or [])
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        except Exception as exc:  # noqa: BLE001 — the last line of defence
            # Type + frames only: an exception MESSAGE can quote what a member wrote
            # (a DB error echoes its parameters); file/line/function cannot.
            # Not even the frames' source text — a literal in a raise can carry data.
            frames = traceback.extract_tb(exc.__traceback__)
            error_logger.error(
                "unhandled %s at %s",
                type(exc).__name__,
                " <- ".join(f"{f.filename}:{f.lineno} {f.name}" for f in reversed(frames[-6:])),
            )
            _report(exc)
            if response_started:
                raise
            body = json.dumps({"detail": GENERIC_500, "request_id": request_id}).encode()
            await send_with_id(
                {
                    "type": "http.response.start",
                    "status": 500,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
        finally:
            route = scope.get("route")
            path = getattr(route, "path", None) or "unmatched"
            if path not in _QUIET_PATHS:
                access_logger.info(
                    "%s %s -> %d in %dms",
                    scope.get("method", "-"),
                    path,
                    status_code,
                    int((time.perf_counter() - started) * 1000),
                )
            _REQUEST_ID.reset(token)
