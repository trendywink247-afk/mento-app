"""WS4 T4.1 — the job queue (Procrastinate on our own Postgres).

The contract every later card leans on:
- a job enqueued inside a request's transaction exists only if that transaction
  commits, and runs after the commit (never before the data it needs is visible);
- a queued job lives in Postgres, not in the API process — a restart loses nothing;
- a job that fails stays queryable (status `failed`), never vanishes;
- a best-effort enqueue that fails can never take the caller's own write down with it.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select, text

from app import jobs
from app.jobs import worker
from app.models.user import User
from tests.conftest import TestSession, requires_postgres, test_engine

pytestmark = requires_postgres

# What the test tasks observed when the worker ran them (same process: the worker
# runs sync tasks in a thread of this interpreter).
SEEN: list[tuple[str, bool]] = []


@jobs.queue.task(name="tests.saw_user", queue="tests")
def saw_user(user_id: str) -> None:
    with TestSession() as db:
        SEEN.append((user_id, db.get(User, user_id) is not None))


@jobs.queue.task(name="tests.always_fails", queue="tests")
def always_fails() -> None:
    raise RuntimeError("boom")


@pytest.fixture(autouse=True)
def _clean_queue(db_session):
    SEEN.clear()
    with test_engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE procrastinate_jobs, procrastinate_events, "
                "procrastinate_periodic_defers RESTART IDENTITY CASCADE"
            )
        )
    yield


def _new_user(db) -> User:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    db.add(u)
    db.flush()
    return u


def _jobs(task_name: str) -> list[tuple[str, int]]:
    with test_engine.connect() as conn:
        return [
            (r.status, r.attempts)
            for r in conn.execute(
                text("SELECT status, attempts FROM procrastinate_jobs WHERE task_name = :t"),
                {"t": task_name},
            )
        ]


def test_a_job_enqueued_with_data_runs_after_the_commit_and_sees_it():
    with TestSession() as db:
        user = _new_user(db)
        jobs.enqueue(db, saw_user, user_id=user.id)
        # Not visible outside the transaction yet — no worker could pick it up.
        assert _jobs("tests.saw_user") == []
        db.commit()
        user_id = user.id

    assert _jobs("tests.saw_user") == [("todo", 0)]
    worker.drain(queues=["tests"])
    assert SEEN == [(user_id, True)]
    # Succeeded jobs are deleted as they finish (worker.WORKER_OPTIONS).
    assert _jobs("tests.saw_user") == []


def test_a_rolled_back_transaction_takes_its_job_with_it():
    with TestSession() as db:
        user = _new_user(db)
        jobs.enqueue(db, saw_user, user_id=user.id)
        db.rollback()

    assert _jobs("tests.saw_user") == []
    worker.drain(queues=["tests"])
    assert SEEN == []


def test_a_queued_job_survives_an_api_restart():
    with TestSession() as db:
        user = _new_user(db)
        jobs.enqueue(db, saw_user, user_id=user.id)
        db.commit()
        user_id = user.id

    # "Restart": every pooled connection the API process held is gone. The job is a
    # row in Postgres, so nothing about it lived in them.
    from app import db as app_db

    app_db.engine.dispose()
    test_engine.dispose()

    worker.drain(queues=["tests"])
    assert SEEN == [(user_id, True)]


def test_a_failed_job_stays_queryable():
    with TestSession() as db:
        jobs.enqueue(db, always_fails)
        db.commit()

    worker.drain(queues=["tests"])
    assert _jobs("tests.always_fails") == [("failed", 1)]


def test_a_best_effort_enqueue_that_fails_never_costs_the_callers_write():
    with TestSession() as db:
        user = _new_user(db)
        assert jobs.enqueue(db, saw_user, queueing_lock="one", user_id=user.id) is not None
        # Same queueing lock while the first is still queued: Procrastinate refuses.
        assert (
            jobs.enqueue(db, saw_user, queueing_lock="one", best_effort=True, user_id=user.id)
            is None
        )
        db.commit()
        user_id = user.id

    with TestSession() as db:
        assert db.scalar(select(User.id).where(User.id == user_id)) == user_id
    assert _jobs("tests.saw_user") == [("todo", 0)]


def test_a_strict_enqueue_that_fails_raises():
    with TestSession() as db:
        user = _new_user(db)
        jobs.enqueue(db, saw_user, queueing_lock="two", user_id=user.id)
        with pytest.raises(jobs.EnqueueFailed):
            jobs.enqueue(db, saw_user, queueing_lock="two", user_id=user.id)
        db.rollback()
