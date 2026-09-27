"""The job worker: `python -m app.jobs.worker` (the `worker` compose service).

One process, beside the API containers, on the same image. It runs queued jobs and
the periodic ones (app/jobs/tasks.py), and it is the only process that opens the
queue's connection pool — the API only ever writes job rows in its own transactions.

Stopping it is safe: a job it was running finishes (or is retried by the next worker
after the graceful timeout); queued jobs wait in Postgres for the next start.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable
from typing import Any

from procrastinate import PsycopgConnector
from sqlalchemy.engine import make_url

from app.config import get_settings
from app.jobs import queue

logger = logging.getLogger("mento.jobs")

# Succeeded jobs are deleted as they finish (a push job's row has nothing worth
# keeping); failed ones stay for the admin health view until the retention job.
WORKER_OPTIONS: dict[str, Any] = {
    "concurrency": 4,  # sync tasks run in threads; each opens its own DB session
    "delete_jobs": "successful",
    "shutdown_graceful_timeout": 20,
}


def conninfo() -> str:
    """DATABASE_URL in libpq form (SQLAlchemy's `+psycopg` driver suffix dropped)."""
    url = make_url(get_settings().database_url).set(drivername="postgresql")
    return url.render_as_string(hide_password=False)


async def _run(**options: Any) -> None:
    # A fresh connector per run, on the SAME app object (replace_connector): tasks and
    # the periodic scheduler hold a link back to `queue`, so a copied app
    # (with_connector) would leave them deferring through a connector never opened.
    # The connector owns its pool, so closing it leaves nothing behind for a next run.
    connector = PsycopgConnector(conninfo=conninfo(), min_size=1, max_size=4)
    with queue.replace_connector(connector) as app:
        async with app.open_async():
            await app.run_worker_async(**{**WORKER_OPTIONS, **options})


def drain(queues: Iterable[str] | None = None) -> None:
    """Run every job that is due right now, then return (tests, one-off ops).
    Same options as the long-running worker, minus the waiting. Like any worker start,
    it also queues a periodic job whose tick is due (it runs if its queue is drained)."""
    asyncio.run(
        _run(
            queues=list(queues) if queues is not None else None,
            wait=False,
            listen_notify=False,
            install_signal_handlers=False,
        )
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    from app.observability import init_sentry

    init_sentry(get_settings())
    logger.info("job worker starting")
    asyncio.run(_run())


if __name__ == "__main__":
    main()
