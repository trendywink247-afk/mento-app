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


def _worker_db_url(url: str) -> str:
    """Each pytest-xdist worker gets its OWN database, created on the fly.

    The suite truncates shared tables between tests, so workers on one database would
    wipe each other's rows. `gw0`, `gw1`, … each get `<db>_gw0`, `<db>_gw1`; a plain
    (non-parallel) run is untouched. Test databases only — never prod.
    """
    import os

    worker = os.environ.get("PYTEST_XDIST_WORKER")
    if not worker or not url.startswith("postgresql"):
        return url
    base, _, name = url.rpartition("/")
    name = name.split("?")[0]
    target = f"{name}_{worker}"
    admin = create_engine(f"{base}/postgres", isolation_level="AUTOCOMMIT", future=True)
    with admin.connect() as conn:
        exists = conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :n"), {"n": target}
        ).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{target}"'))
    admin.dispose()
    return f"{base}/{target}"


DB_URL = _worker_db_url(get_settings().database_url)
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

if DB_URL != get_settings().database_url:  # a parallel worker: point the app at its own DB too
    import os

    os.environ["DATABASE_URL"] = DB_URL
    get_settings.cache_clear()
    from app import db as _app_db

    _app_db.engine.dispose()
    # Keep production pool/statement-timeout settings when rebinding each worker.
    # A bare create_engine silently dropped the 5-second statement cap under xdist.
    _app_db.engine = create_engine(DB_URL, **_app_db.engine_kwargs(get_settings()))
    _app_db.SessionLocal.configure(bind=_app_db.engine)


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
def _name_rotation_off():
    """Mentor names rotate at 04:00 IST (services/mentor_names.py). Off by default so a
    suite asserting on seeded names can never meet the boundary; the rotation tests
    flip the module switch back on."""
    from app.services import mentor_names

    previous = mentor_names.ENABLED
    mentor_names.ENABLED = False
    yield
    mentor_names.ENABLED = previous


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
    # Same for the rename a name rotation pushes to Stream (tests that care replace it).
    monkeypatch.setattr(stream, "rename_user", lambda user_id, persona_name: True)
    # Same for Clean Wipe / erasure's channel delete — a seeded own-chat conversation's
    # stream_channel_id is never a real Stream channel (session 48: this is what made
    # the wipe test hit a real 404 against this machine's real Stream creds). Tests that
    # care about the call still replace it themselves (matches the existing per-test
    # monkeypatches this fixture doesn't override — the last patch in a test wins).
    monkeypatch.setattr(stream, "wipe_channel", lambda channel_id: None)
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
                    "TRUNCATE erasure_receipts, conversations, listener_profiles, users, safety_flags, "
                    "moderation_events, journal_entries, conversation_reflections, "
                    "conversation_requests, push_tokens, message_allowance_days, mentor_links, "
                    "listener_name_history, product_feedback, procrastinate_jobs "
                    "RESTART IDENTITY CASCADE"
                )
            )
    session = TestSession()
    try:
        yield session
    finally:
        session.close()
