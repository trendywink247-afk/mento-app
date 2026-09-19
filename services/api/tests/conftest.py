"""Test fixtures for the matching concurrency suite.

These tests prove that General matching cannot double-assign a listener under
concurrency. That guarantee depends on `SELECT ... FOR UPDATE SKIP LOCKED`,
which is a *no-op on SQLite* — so the suite only runs against Postgres.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.config import get_settings

API_DIR = Path(__file__).resolve().parents[1]  # services/api

DB_URL = get_settings().database_url
IS_POSTGRES = DB_URL.startswith("postgresql")

# Marker for tests that are meaningless without real row-level locking.
requires_postgres = pytest.mark.skipif(
    not IS_POSTGRES,
    reason="Postgres required: SELECT ... FOR UPDATE SKIP LOCKED is a no-op on SQLite.",
)

# Dedicated engine with a pool large enough that every worker thread can hold a
# live connection at once — otherwise the pool would serialize them and we'd
# never actually exercise concurrent matching.
TEST_POOL_SIZE = 64
test_engine = create_engine(
    DB_URL, pool_size=TEST_POOL_SIZE, max_overflow=0, pool_pre_ping=True, future=True
)
TestSession = sessionmaker(bind=test_engine, autoflush=False, autocommit=False, future=True)


@pytest.fixture(autouse=True)
def _rate_limits_off():
    """Rate limits are off by default in tests (fixed windows would couple suites
    run-to-run through Redis). The rate-limit tests flip the module switch back on
    around per-test-unique keys."""
    from app import ratelimit

    previous = ratelimit.ENABLED
    ratelimit.ENABLED = False
    yield
    ratelimit.ENABLED = previous


@pytest.fixture(autouse=True)
def _push_off():
    """Push is off by default in tests (no network); tests/test_push.py flips it on
    per test and records sends."""
    from app.services import push

    previous = push.ENABLED
    push.ENABLED = False
    yield
    push.ENABLED = previous


@pytest.fixture(autouse=True)
def sealed_channels(monkeypatch):
    """Hermetic: a safety end (report / block / suspend) freezes the Stream channel,
    and this machine's .env may carry real Stream creds. Record instead of calling —
    tests assert on the returned list."""
    from app.services import stream

    calls: list[str] = []

    def _record(channel_id: str) -> bool:
        calls.append(channel_id)
        return True

    monkeypatch.setattr(stream, "freeze_channel", _record)
    return calls


@pytest.fixture(scope="session", autouse=True)
def _schema():
    """Build the schema from the Alembic migration (not metadata.create_all), so
    the test runs against exactly the DDL that ships to staging/prod."""
    if not IS_POSTGRES:
        yield
        return
    command.upgrade(Config(str(API_DIR / "alembic.ini")), "head")
    yield


@pytest.fixture
def db_session():
    """Reset the matching-related tables, then yield a setup session."""
    if IS_POSTGRES:
        with test_engine.begin() as conn:
            conn.execute(
                text(
                    "TRUNCATE conversations, listener_profiles, users, safety_flags, "
                    "moderation_events, journal_entries, conversation_reflections, "
                    "conversation_requests, push_tokens "
                    "RESTART IDENTITY CASCADE"
                )
            )
    session = TestSession()
    try:
        yield session
    finally:
        session.close()
