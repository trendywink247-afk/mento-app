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


# Sentry environment for each ENV value. Anything not listed (dev, unset, a typo) maps
# to None = Sentry off, so a misconfigured host can never report as production.
_SENTRY_ENVIRONMENTS = {"qa": "qa", "staging": "qa", "production": "production"}

# Allowlists: an event is REBUILT from these, so a key the SDK adds later is dropped
# by default rather than leaked by default.
_KEEP_TOP = ("event_id", "timestamp", "platform", "level", "sdk", "release", "environment")
_KEEP_TAGS = ("request_id", "runtime", "handled", "mechanism")
_KEEP_CONTEXTS = ("runtime", "os")
_KEEP_FRAME = ("filename", "abs_path", "function", "module", "lineno", "colno", "in_app")
_KEEP_MECHANISM = ("type", "handled")
SCRUBBED = "[scrubbed]"


def sentry_environment(env: str) -> str | None:
    return _SENTRY_ENVIRONMENTS.get((env or "").strip().lower())


def _scrub_exception(exc: object) -> dict:
    out: dict = {"value": SCRUBBED}  # a message can quote what a member wrote
    if not isinstance(exc, dict):
        return out
    for key in ("type", "module"):
        if isinstance(exc.get(key), str):
            out[key] = exc[key]
    mechanism = exc.get("mechanism")
    if isinstance(mechanism, dict):
        out["mechanism"] = {k: mechanism[k] for k in _KEEP_MECHANISM if k in mechanism}
    stacktrace = exc.get("stacktrace")
    if isinstance(stacktrace, dict):
        frames = stacktrace.get("frames")
        if isinstance(frames, list):
            # No vars, no pre/post/context_line: source text and locals can hold content.
            out["stacktrace"] = {
                "frames": [
                    {k: f[k] for k in _KEEP_FRAME if k in f} for f in frames if isinstance(f, dict)
                ]
            }
    return out


def scrub_event(event: dict, _hint: dict) -> dict | None:
    """Sentry `before_send`: build the event from an allowlist and drop the rest.

    Kept: id, time, level, release, environment, exception TYPE + frames (file, line,
    function), method + URL without its query string, the route-template transaction.
    Dropped: exception and log MESSAGES, breadcrumbs, request body / query / cookies /
    headers / env, user and every IP field, extra, `_meta` (it can hold the original of
    a redacted value). Fails closed: if scrubbing itself raises, the event is dropped.
    """
    try:
        return _scrub(event)
    except Exception:  # noqa: BLE001 — never let an unscrubbed event through
        return None


def _scrub(event: dict) -> dict:
    out: dict = {k: event[k] for k in _KEEP_TOP if k in event}
    if isinstance(event.get("server_name"), str):
        out["server_name"] = event["server_name"]
    if isinstance(event.get("transaction"), str):
        out["transaction"] = event["transaction"]

    exception = event.get("exception")
    if isinstance(exception, dict) and isinstance(exception.get("values"), list):
        out["exception"] = {"values": [_scrub_exception(v) for v in exception["values"]]}

    if event.get("message") or event.get("logentry"):
        out["logentry"] = {"message": SCRUBBED}

    request = event.get("request")
    if isinstance(request, dict):
        scrubbed_request: dict = {}
        if isinstance(request.get("method"), str):
            scrubbed_request["method"] = request["method"]
        if isinstance(request.get("url"), str):
            scrubbed_request["url"] = request["url"].split("?", 1)[0].split("#", 1)[0]
        out["request"] = scrubbed_request

    tags = event.get("tags")
    if isinstance(tags, dict):
        out["tags"] = {k: v for k, v in tags.items() if k in _KEEP_TAGS}
    contexts = event.get("contexts")
    if isinstance(contexts, dict):
        out["contexts"] = {k: v for k, v in contexts.items() if k in _KEEP_CONTEXTS}
    return out


def sentry_options(settings: Settings) -> dict | None:
    """None = Sentry stays off (no DSN, or ENV is not qa/staging/production)."""
    environment = sentry_environment(settings.env)
    if not settings.sentry_dsn or environment is None:
        return None
    options: dict = {
        "dsn": settings.sentry_dsn,
        "environment": environment,
        "send_default_pii": False,
        "traces_sample_rate": 0.0,  # errors only — no performance tracing for now
        "profiles_sample_rate": 0.0,
        "include_local_variables": False,
        "include_source_context": False,
        "max_request_body_size": "never",
        "max_breadcrumbs": 0,
        "before_send": scrub_event,
        "before_send_transaction": lambda _event, _hint: None,
        "before_breadcrumb": lambda _crumb, _hint: None,
    }
    if settings.git_sha:
        options["release"] = settings.git_sha
    return options


def init_sentry(settings: Settings) -> None:
    """No-op unless there is a DSN and ENV is qa/staging/production."""
    options = sentry_options(settings)
    if options is None:
        return
    import sentry_sdk

    sentry_sdk.init(**options)


# --- Request context: one id per request, on every log line and every response ------

_REQUEST_ID: contextvars.ContextVar[str] = contextvars.ContextVar("mento_request_id", default="-")
_INBOUND_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
_QUIET_PATHS = {"/api/v1/health"}  # the container healthcheck hits this every 30 s

access_logger = logging.getLogger("mento.access")
error_logger = logging.getLogger("mento.errors")

GENERIC_500 = "Something went wrong on our side. Please try again in a moment."


def _route_template(scope: Scope) -> str:
    """The matched route's FULL template (`/api/v1/conversations/{convo_id}`).

    Since FastAPI 0.13x, `scope["route"]` is the router's own route, whose path no
    longer carries the `include_router(prefix=...)` part. Rebuild it from public
    attributes: the prefix is whatever the raw path holds before the route's own
    regex matches. Our include prefixes are literal (`/api/v1`), so this never puts
    an id in the log line.
    """
    route = scope.get("route")
    template = getattr(route, "path", None)
    if not template:
        return "unmatched"
    regex = getattr(route, "path_regex", None)
    raw = scope.get("path", "")
    if regex is None or regex.match(raw):
        return template
    for i, ch in enumerate(raw):
        if ch == "/" and i and regex.match(raw[i:]):
            return raw[:i] + template
    return template


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
            path = _route_template(scope)
            if path not in _QUIET_PATHS:
                access_logger.info(
                    "%s %s -> %d in %dms",
                    scope.get("method", "-"),
                    path,
                    status_code,
                    int((time.perf_counter() - started) * 1000),
                )
            _REQUEST_ID.reset(token)
