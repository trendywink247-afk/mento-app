"""The job queue (WS4) — Procrastinate on our own Postgres. No new infrastructure:
jobs are rows in `procrastinate_jobs`, run by `python -m app.jobs.worker`.

Two halves, deliberately split:

- **Enqueue (API side, sync):** `enqueue(db, task, **kwargs)` writes the job on the
  SQLAlchemy session's OWN connection, inside its current transaction. The job exists
  only if the caller commits, so a worker can never pick it up before the data it
  needs is visible — and a rolled-back request leaves no job behind. Nothing here
  opens a pool; the API process never needs the queue's connector.
- **Run (worker side, async):** `queue` is the Procrastinate app the worker opens
  (app/jobs/worker.py). Tasks are registered on it in app/jobs/tasks.py.

Job arguments are stored in Postgres: ids and closed template values only — never a
message body, an email, or anything a member wrote.
"""

from __future__ import annotations

import logging
from typing import Any

from procrastinate import App, PsycopgConnector, SyncPsycopgConnector
from procrastinate.manager import JobManager
from procrastinate.tasks import Task
from sqlalchemy.orm import Session

logger = logging.getLogger("mento.jobs")

# The worker opens this with a pool built from DATABASE_URL (worker.py); until then
# the connector holds no connection at all.
queue = App(connector=PsycopgConnector(), import_paths=["app.jobs.tasks"])

# Deferral on a caller-supplied connection needs no pool: Procrastinate runs its
# `defer_jobs` query on the connection it is handed.
_defer_manager = JobManager(SyncPsycopgConnector())


class EnqueueFailed(Exception):
    """A strict enqueue did not land. The caller's transaction is still usable."""


def enqueue(
    db: Session,
    task: Task[Any, Any, Any],
    /,
    *,
    queueing_lock: str | None = None,
    best_effort: bool = False,
    **task_kwargs: Any,
) -> int | None:
    """Add `task(**task_kwargs)` to the queue as part of `db`'s current transaction.

    Runs in a SAVEPOINT, so a failed insert (schema missing, a queueing-lock clash)
    rolls back only the job — never the caller's own write. Strict by default
    (raises `EnqueueFailed`); `best_effort=True` logs and returns None instead, for
    work that must never block the request (pushes).

    Returns the job id. The job runs only once the caller commits.
    """
    try:
        with db.begin_nested():
            raw = db.connection().connection.driver_connection
            job = task.configure(queueing_lock=queueing_lock).make_new_job(**task_kwargs)
            return _defer_manager.defer_job(job, connection=raw).id
    except Exception as exc:  # noqa: BLE001 — classified below, never swallowed silently
        logger.warning("enqueue %s failed: %s", task.name, type(exc).__name__)
        if best_effort:
            return None
        raise EnqueueFailed(task.name) from exc
