"""Minimum app version gate (426 Upgrade Required).

Off unless MIN_APP_VERSION is set. Fail-open by design: a request with no
`X-App-Version`, or one we cannot parse, always passes — old builds, Stream's
server-to-server calls and plain HTTP clients never send it.

SAFETY: an outdated app must still be able to show crisis help, so the paths in
`EXEMPT_*` are NEVER refused, whatever the version. Adding a crisis/safety route?
Add it here and to tests/test_app_version.py.
"""

from __future__ import annotations

import logging
import re

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.config import get_settings

logger = logging.getLogger(__name__)

API_PREFIX = "/api/v1"

# Compared on the path AFTER API_PREFIX. A prefix matches itself or anything below it.
EXEMPT_PREFIXES = (
    "/health",  # /health, /health/ready, /health/crisis
    "/status/public",
    "/stream",  # Stream webhooks send no X-App-Version
    "/safety",  # /safety/scan
    "/feedback",  # crisis words typed into feedback get helplines back
)
# Member and mentor report/block are safety actions; end/wipe let a member close a chat
# and erase it (Clean Wipe) from any build.
EXEMPT_PATTERNS = (
    re.compile(r"^/conversations/[^/]+/(report|block|end|wipe)$"),
    re.compile(r"^/chat/[^/]+/wipe$"),
    re.compile(r"^/listener/me/conversations/[^/]+/report$"),
)
# Method-specific, so GET/PUT /me stay gated while DELETE /me (erase) never is.
EXEMPT_ROUTES = frozenset({("DELETE", "/me")})
# The exempt endpoints above need a member session. These are the only ways an old build
# gets (back) one without creating a new account: the access token lives ~15 minutes, so
# erasing or ending a chat usually needs a refresh first; a lost session needs the
# recovery code. NOT exempt: /onboarding/start (a brand-new account is the very thing the
# gate exists to stop) and /auth/upgrade (legacy tokens already work on exempt routes).
EXEMPT_AUTH_PATHS = frozenset({"/auth/refresh", "/onboarding/recover"})

_VERSION = re.compile(r"^v?(\d+(?:\.\d+){0,3})(?:[-+].*)?$")


def parse_version(raw: str | None) -> tuple[int, ...] | None:
    """'1.4.0' -> (1, 4, 0); None if it is not a dotted numeric version."""
    m = _VERSION.match((raw or "").strip())
    if not m:
        return None
    parts = [int(p) for p in m.group(1).split(".")]
    while len(parts) > 1 and parts[-1] == 0:
        parts.pop()
    return tuple(parts)


def is_exempt(path: str, method: str = "GET") -> bool:
    if not path.startswith(API_PREFIX):
        return True  # docs, openapi, anything outside the versioned API
    rest = path[len(API_PREFIX) :].rstrip("/") or "/"
    if rest in EXEMPT_AUTH_PATHS or (method.upper(), rest) in EXEMPT_ROUTES:
        return True
    if any(rest == p or rest.startswith(p + "/") for p in EXEMPT_PREFIXES):
        return True
    return any(p.match(rest) for p in EXEMPT_PATTERNS)


class MinAppVersionMiddleware:
    """Pure ASGI, like RequestContextMiddleware (no BaseHTTPMiddleware)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] == "OPTIONS":
            await self.app(scope, receive, send)
            return

        raw_min = get_settings().min_app_version.strip()
        if not raw_min or is_exempt(scope["path"], scope["method"]):
            await self.app(scope, receive, send)
            return

        minimum = parse_version(raw_min)
        if minimum is None:
            logger.warning("MIN_APP_VERSION is not a dotted numeric version; check disabled")
            await self.app(scope, receive, send)
            return

        sent = dict(scope.get("headers") or []).get(b"x-app-version", b"").decode("latin-1")
        current = parse_version(sent)
        if current is None or current >= minimum:
            await self.app(scope, receive, send)
            return

        response = JSONResponse(
            status_code=426,
            content={
                "detail": "This version of Mento is out of date. Please update the app to continue.",
                "code": "upgrade_required",
                "min_app_version": raw_min,
            },
        )
        await response(scope, receive, send)
