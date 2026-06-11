"""Mento API entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import init_db
from app.routers import (
    conversation,
    health,
    journals,
    listeners,
    match,
    moderation,
    onboarding,
    safety,
    stream_hooks,
)

logging.basicConfig(level=logging.INFO)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dev convenience: create tables from models. Staging/prod use Alembic migrations.
    if settings.is_dev:
        init_db()
    yield


app = FastAPI(title="Mento API", version="0.1.0", lifespan=lifespan)

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
app.include_router(safety.router, prefix=API)
app.include_router(conversation.router, prefix=API)
app.include_router(stream_hooks.router, prefix=API)
app.include_router(moderation.router, prefix=API)
app.include_router(journals.router, prefix=API)
app.include_router(listeners.router, prefix=API)
