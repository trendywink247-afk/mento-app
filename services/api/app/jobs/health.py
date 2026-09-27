"""The job queue's vital signs for admin Health (WS4 T4.4).

Task names and counts only — a job's arguments are ids, and they never leave the
database. Read-only; a missing schema reads as `available=False`, never a 500.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("mento.jobs")

# procrastinate's worker heartbeats every 10 s; a minute of silence is a dead worker.
WORKER_SILENT_AFTER_SECONDS = 60

_COUNTS = text(
    """
    SELECT
      count(*) FILTER (WHERE status = 'todo'
                       AND (scheduled_at IS NULL OR scheduled_at <= now())) AS queued,
      count(*) FILTER (WHERE status = 'todo' AND scheduled_at > now())      AS scheduled,
      count(*) FILTER (WHERE status = 'doing')                              AS running
    FROM procrastinate_jobs
    """
)
# Oldest DUE job's age, from its `deferred` event: the "nobody is working the queue" signal.
_OLDEST = text(
    """
    SELECT EXTRACT(EPOCH FROM now() - min(e.at))
    FROM procrastinate_jobs j JOIN procrastinate_events e ON e.job_id = j.id
    WHERE j.status = 'todo' AND (j.scheduled_at IS NULL OR j.scheduled_at <= now())
      AND e.type = 'deferred'
    """
)
_FAILED = text(
    """
    SELECT j.task_name, count(DISTINCT j.id)
    FROM procrastinate_jobs j JOIN procrastinate_events e ON e.job_id = j.id
    WHERE j.status = 'failed' AND e.at > now() - interval '24 hours'
    GROUP BY j.task_name
    """
)
_HEARTBEAT = text(
    "SELECT EXTRACT(EPOCH FROM now() - max(last_heartbeat)) FROM procrastinate_workers"
)


def queue_health(db: Session) -> dict:
    try:
        counts = db.execute(_COUNTS).one()
        oldest = db.execute(_OLDEST).scalar()
        failed = {name: n for name, n in db.execute(_FAILED).all()}
        heartbeat = db.execute(_HEARTBEAT).scalar()
    except Exception as exc:  # noqa: BLE001 — health must report, not crash
        db.rollback()
        logger.warning("job queue health unavailable: %s", type(exc).__name__)
        return {"available": False}
    heartbeat_s = None if heartbeat is None else int(heartbeat)
    return {
        "available": True,
        "queued": counts.queued,
        "scheduled": counts.scheduled,
        "running": counts.running,
        "failed_24h": failed,
        "oldest_queued_seconds": None if oldest is None else int(oldest),
        "worker_last_heartbeat_seconds": heartbeat_s,
        "worker_alive": heartbeat_s is not None and heartbeat_s < WORKER_SILENT_AFTER_SECONDS,
    }
