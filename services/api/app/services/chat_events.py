"""Own-chat events that must wait for a commit (WS5 T5.4).

A conversation ends — or is wiped — inside some caller's transaction (member End,
mentor End, report, block, suspension, Clean Wipe: every path goes through
services/conversations.py). The sockets must hear about it only if that transaction
COMMITS, and never before. `after_commit(db, conversation_id, event)` queues an event
on the session; a listener publishes the queue when the ROOT transaction commits (a
savepoint release does not count) and drops it when the transaction ends any other way.

Kept apart from services/chat.py so conversations.py can import it without an import
cycle (chat → member_status → conversations).
"""

from __future__ import annotations

import logging

import anyio.from_thread
from sqlalchemy import event
from sqlalchemy.orm import Session, SessionTransaction

from app.chat_hub import hub

logger = logging.getLogger("mento.chat.events")

_KEY = "mento.chat_events"


def publish(conversation_id: str, event_: dict) -> None:
    """Fan an event out to every socket of the conversation, on every worker. From an
    anyio worker thread (sync routes, the WebSocket layer's `_db`) it hops onto the
    event loop that owns the sockets; elsewhere (a job, a script) it publishes straight
    to Valkey. Lossy by design — Postgres is the truth — but never silent."""
    try:
        anyio.from_thread.run(hub.publish, conversation_id, event_)
        return
    except RuntimeError:
        pass  # not on an anyio worker thread
    if not hub.publish_sync(conversation_id, event_):
        logger.warning("chat event not published — clients catch up by seq")


def after_commit(db: Session, conversation_id: str, event_: dict) -> None:
    db.info.setdefault(_KEY, []).append((conversation_id, event_))


@event.listens_for(Session, "after_commit")
def _flush(session: Session) -> None:
    if session.in_nested_transaction():
        return  # a savepoint released; the outer transaction may still roll back
    for conversation_id, event_ in session.info.pop(_KEY, []):
        try:
            publish(conversation_id, event_)
        except Exception as exc:  # noqa: BLE001 — the commit already happened
            logger.warning("chat %s event not published (%s)", event_.get("t"), type(exc).__name__)


@event.listens_for(Session, "after_transaction_end")
def _discard(session: Session, transaction: SessionTransaction) -> None:
    if transaction.parent is None:
        session.info.pop(_KEY, None)  # rolled back (a commit flushed it already)
