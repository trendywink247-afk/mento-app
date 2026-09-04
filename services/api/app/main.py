"""Mento API entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.config import get_settings
from app.db import init_db
from app.routers import (
    admin_console,
    conversation,
    health,
    journals,
    listener_applications,
    listener_console,
    listeners,
    match,
    notifications,
    onboarding,
    paths,
    safety,
    stream_hooks,
)

logging.basicConfig(level=logging.INFO)
settings = get_settings()

if settings.sentry_dsn:
    import sentry_sdk

    def _strip_request_body(event: dict, _hint: dict) -> dict:
        """Message content must never reach Sentry (T&S #10) — drop request
        bodies/data wholesale; URL + method + status are enough to debug."""
        request = event.get("request")
        if isinstance(request, dict):
            request.pop("data", None)
            request.pop("body", None)
        return event

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.env,
        send_default_pii=False,
        traces_sample_rate=0.0,  # errors only — no performance tracing
        before_send=_strip_request_body,
    )


def _enforce_prod_invariants() -> None:
    """Refuse to boot in a state that silently breaks a security guarantee.

    - The published default JWT secret would let anyone forge user AND listener
      tokens (they share the secret, differing only by a role claim).
    - Missing Stream creds make verify_webhook reject every webhook, which — with
      Stream's fail-open delivery — disables the crisis scan entirely and SILENTLY
      (Trust & Safety #1 must never be off without anyone noticing).
    - An empty CORS allowlist silently bricks the web-only listener/admin consoles
      (they call this API cross-origin from console_base_url).
    - An empty or shared ADMIN_JWT_SECRET means a leaked user/listener secret can
      forge admin tokens — the highest-privilege credential must have its own key.
    """
    problems = []
    if settings.jwt_secret == "change-me-long-random":
        problems.append("JWT_SECRET is the published default — set a long random value")
    if not (settings.stream_api_key and settings.stream_api_secret):
        problems.append(
            "STREAM_API_KEY/SECRET missing — the crisis-scan webhook would reject "
            "everything and messages would flow unscanned"
        )
    if not settings.resolved_cors_origins:
        problems.append(
            "CORS origin list is empty — set CORS_ORIGINS (comma-separated) or a "
            "valid CONSOLE_BASE_URL so the web consoles can reach the API"
        )
    if not settings.admin_jwt_secret or settings.admin_jwt_secret == settings.jwt_secret:
        problems.append(
            "ADMIN_JWT_SECRET is empty or equal to JWT_SECRET — set a distinct "
            "long random value so admin tokens can't be forged with the shared secret"
        )
    if problems:
        raise RuntimeError(f"unsafe {settings.env} configuration: " + "; ".join(problems))


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.is_dev:
        _enforce_prod_invariants()
    # Dev convenience: create tables from models. Staging/prod use Alembic migrations.
    if settings.is_dev:
        init_db()
    yield


app = FastAPI(title="Mento API", version="0.1.0", lifespan=lifespan)

# List payloads (conversations, listeners, journals) compress well; cheap win for
# mobile networks. Small floor so tiny JSON bodies skip the overhead.
app.add_middleware(GZipMiddleware, minimum_size=1024)

# Mobile app + Expo web. Dev = wildcard; otherwise CORS_ORIGINS, falling back to
# console_base_url's origin (the web-only consoles must reach this API cross-origin).
# Auth is Bearer-token based (no cookies), so credentials are off — this keeps the
# wildcard origin valid per the CORS spec (allow_credentials + "*" is rejected by browsers).
if not settings.is_dev and not settings.cors_origin_list:
    logging.getLogger(__name__).warning(
        "CORS_ORIGINS not set — falling back to console_base_url origin %s; "
        "set CORS_ORIGINS explicitly for %s",
        settings.resolved_cors_origins,
        settings.env,
    )
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.resolved_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

API = "/api/v1"
app.include_router(health.router, prefix=API)
app.include_router(onboarding.router, prefix=API)
app.include_router(match.router, prefix=API)
app.include_router(paths.router, prefix=API)
app.include_router(safety.router, prefix=API)
app.include_router(conversation.router, prefix=API)
app.include_router(stream_hooks.router, prefix=API)
app.include_router(journals.router, prefix=API)
app.include_router(listener_applications.router, prefix=API)
app.include_router(listeners.router, prefix=API)
app.include_router(listener_console.router, prefix=API)
app.include_router(admin_console.router, prefix=API)
app.include_router(notifications.router, prefix=API)
