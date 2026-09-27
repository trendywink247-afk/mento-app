"""Every job the worker runs. Tasks are thin: they open their own DB session and call
the service that owns the logic, so the same code still runs inline where a card
keeps an inline fallback."""

from __future__ import annotations

from procrastinate import RetryStrategy

from app.db import SessionLocal
from app.jobs import queue
from app.services import push

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
