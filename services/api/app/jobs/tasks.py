"""Every job the worker runs. Tasks are thin: they open their own DB session and call
the service that owns the logic, so the same code still runs inline where a card
keeps an inline fallback."""

from __future__ import annotations

import logging

from procrastinate import RetryStrategy
from sqlalchemy import text

from app.config import get_settings
from app.db import SessionLocal
from app.jobs import queue, retention
from app.services import matching, mentor_names, push, snooze

logger = logging.getLogger("mento.jobs")

# --- push (T4.2) --------------------------------------------------------------------
# Arguments are ids and closed-template values only (push.TEMPLATES) — never a body
# anyone wrote. The decision jobs do not retry: re-running one would trip its own
# burst window. A failed SEND becomes push.deliver, which does.


@queue.task(name="push.request_created", queue="push")
def push_request_created(request_id: str) -> None:
    with SessionLocal() as db:
        push.notify_request_created(db, request_id=request_id)


@queue.task(name="push.request_accepted", queue="push")
def push_request_accepted(request_id: str) -> None:
    with SessionLocal() as db:
        push.notify_request_accepted(db, request_id=request_id)


@queue.task(name="push.message", queue="push")
def push_message(channel_id: str, sender_id: str) -> None:
    with SessionLocal() as db:
        push.notify_message_for_channel(db, channel_id=channel_id, sender_stream_user_id=sender_id)


# 4 s, 16 s, 64 s, then the job is `failed` (visible in admin Health). A push later
# than that is noise, not help.
@queue.task(
    name="push.deliver",
    queue="push",
    retry=RetryStrategy(
        max_attempts=3, exponential_wait=4, retry_exceptions=[push.PushTransportError]
    ),
)
def push_deliver(recipient_kind: str, recipient_id: str, body: str, data: dict) -> None:
    with SessionLocal() as db:
        push.deliver(
            db, recipient_kind=recipient_kind, recipient_id=recipient_id, body=body, data=data
        )


# --- snooze (T4.3) ------------------------------------------------------------------


@queue.task(
    name="snooze.end_on_mentor_reply",
    queue="default",
    retry=RetryStrategy(max_attempts=3, exponential_wait=4),
)
def snooze_end_on_mentor_reply(channel_id: str, sender_id: str) -> None:
    with SessionLocal() as db:
        snooze.end_on_mentor_reply(db, channel_id, sender_id)


# --- mentor names (T4.3) ------------------------------------------------------------


@queue.task(name="mentor_names.sync_stream", queue="default", queueing_lock="mentor-names-sync")
def mentor_names_sync_stream() -> None:
    mentor_names.sync_stream_names()


# Cron is UTC: 22:30 UTC = 04:00 IST, the rotation hour (mentor_names.ROTATION_HOUR_IST).
# The lazy pass on every name-showing read stays as the fallback.
@queue.periodic(cron="30 22 * * *", periodic_id="mentor-names")
@queue.task(name="maintenance.mentor_names", queue="maintenance", queueing_lock="maint-names")
def maintenance_mentor_names(timestamp: int) -> None:
    mentor_names.run_pass()


# --- capacity + presence (T4.3) -----------------------------------------------------


# Every 5 minutes: stale chats ended, counters recounted, silent consoles marked away.
# match_general keeps its inline self-heal for the moment a member is waiting.
@queue.periodic(cron="*/5 * * * *", periodic_id="capacity")
@queue.task(name="maintenance.capacity", queue="maintenance", queueing_lock="maint-capacity")
def maintenance_capacity(timestamp: int) -> dict[str, int]:
    with SessionLocal() as db:
        result = matching.reconcile_listener_capacity(db)
        db.commit()
    if any(result.values()):
        logger.info("capacity sweep %s", result)
    return result


# --- the queue's own retention ------------------------------------------------------

JOB_RETENTION_DAYS = 30


# Succeeded jobs are deleted as they finish; failed / cancelled / aborted ones stay for
# the admin Health view, then go after JOB_RETENTION_DAYS with no activity.
@queue.periodic(cron="17 3 * * *", periodic_id="prune-jobs")
@queue.task(name="maintenance.prune_jobs", queue="maintenance", queueing_lock="maint-prune")
def maintenance_prune_jobs(timestamp: int) -> int:
    with SessionLocal() as db:
        result = db.execute(
            text(
                "DELETE FROM procrastinate_jobs j "
                "WHERE j.status IN ('failed', 'cancelled', 'aborted', 'succeeded') "
                "AND NOT EXISTS (SELECT 1 FROM procrastinate_events e WHERE e.job_id = j.id "
                "AND e.at > now() - make_interval(days => :days))"
            ),
            {"days": JOB_RETENTION_DAYS},
        )
        db.commit()
    return result.rowcount


# --- own-chat message partitions (WS5 T5.6) --------------------------------------------


@queue.periodic(cron="41 2 * * *", periodic_id="chat-partitions")
@queue.task(
    name="maintenance.chat_partitions", queue="maintenance", queueing_lock="maint-chat-parts"
)
def maintenance_chat_partitions(timestamp: int) -> dict[str, list[str]]:
    """Keep next months' partitions ready and drop the expired ones. With no retention
    decided (message_retention_days unset, founder decision H13) nothing is dropped."""
    with SessionLocal() as db:
        ready = retention.ensure_partitions(db)
        dropped = retention.drop_expired(db, get_settings().message_retention_days)
        stray = retention.default_partition_rows(db)
        db.commit()
    if stray:
        logger.error(
            "chat_messages_default holds %d row(s) — a monthly partition was missing when "
            "they were written; that month's partition cannot be created until they move",
            stray,
        )
    return {"ready": ready, "dropped": dropped}
