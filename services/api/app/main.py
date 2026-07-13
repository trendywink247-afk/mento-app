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
    listener_console,
    listeners,
    match,
    moderation,
    onboarding,
    paths,
    safety,
    stream_hooks,
)

logging.basicConfig(level=logging.INFO)
settings = get_settings()


def _enforce_prod_invariants() -> None:
    """Refuse to boot in a state that silently breaks a security guarantee.

    - The published default JWT secret would let anyone forge user AND listener
      tokens (they share the secret, differing only by a role claim).
    - Missing Stream creds make verify_webhook reject every webhook, which — with
      Stream's fail-open delivery — disables the crisis scan entirely and SILENTLY
      (Trust & Safety #1 must never be off without anyone noticing).
    """
    problems = []
    if settings.jwt_secret == "change-me-long-random":
        problems.append("JWT_SECRET is the published default — set a long random value")
    if not (settings.stream_api_key and settings.stream_api_secret):
        problems.append(
            "STREAM_API_KEY/SECRET missing — the crisis-scan webhook would reject "
            "everything and messages would flow unscanned"
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

# Mobile app + Expo web. Tighten origins per environment before prod.
# Auth is Bearer-token based (no cookies), so credentials are off — this keeps the
# wildcard origin valid per the CORS spec (allow_credentials + "*" is rejected by browsers).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.is_dev else [],
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
app.include_router(moderation.router, prefix=API)
app.include_router(journals.router, prefix=API)
app.include_router(listeners.router, prefix=API)
app.include_router(listener_console.router, prefix=API)
app.include_router(admin_console.router, prefix=API)
