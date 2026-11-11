"""Producers of live events (docs/LIVE_EVENTS.md): "something about this id changed, look again".

Events carry ids only — never message text, names or anything personal — and only ever go to
identities that may already read the thing named: the member who asked, the mentor it is
addressed to, the mentors whose inbox holds a broadcast (services/request_visibility.py).

Two ways in, both of which never fail the caller (log and carry on):
  - `emit(db, ...)` queues the event on the session; it is published only when the ROOT
    transaction commits, and dropped when it rolls back (same rule as chat_events.py).
  - `publish(...)` sends now, for code that runs after its commit already happened.

Publishing hops onto the event loop from a sync route's worker thread (anyio), or goes
straight to Valkey from a job or script (no loop). See app/events_hub.py for fan-out.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable

import anyio.from_thread
from sqlalchemy import event
from sqlalchemy.orm import Session, SessionTransaction

from app.events_hub import hub

logger = logging.getLogger("mento.events")

_KEY = "mento.live_events"


def _payload(members: Iterable[str | None], listeners: Iterable[str | None], ev: dict) -> dict:
    return {
        "m": sorted({m for m in members if m}),
        "l": sorted({li for li in listeners if li}),
        "ev": ev,
    }


def publish(
    *, members: Iterable[str | None] = (), listeners: Iterable[str | None] = (), ev: dict
) -> None:
    payload = _payload(members, listeners, ev)
    if not payload["m"] and not payload["l"]:
        return
    try:
        try:
            anyio.from_thread.run(hub.publish, payload)
            return
        except RuntimeError:
            pass  # not on an anyio worker thread (a job, a script, a test)
        if not hub.publish_sync(payload):
            logger.warning(
                "live %s not published — apps catch up on their next refetch", ev.get("t")
            )
    except Exception as exc:  # noqa: BLE001 — an event is a hint; it never fails a request
        logger.warning("live %s not published (%s)", ev.get("t"), type(exc).__name__)


def emit(
    db: Session,
    *,
    members: Iterable[str | None] = (),
    listeners: Iterable[str | None] = (),
    ev: dict,
) -> None:
    db.info.setdefault(_KEY, []).append(_payload(members, listeners, ev))


@event.listens_for(Session, "after_commit")
def _flush(session: Session) -> None:
    if session.in_nested_transaction():
        return
    for payload in session.info.pop(_KEY, []):
        publish(members=payload["m"], listeners=payload["l"], ev=payload["ev"])


@event.listens_for(Session, "after_transaction_end")
def _discard(session: Session, transaction: SessionTransaction) -> None:
    if transaction.parent is None:
        session.info.pop(_KEY, None)


# ---- the events, by name (the contract lives here and in docs/LIVE_EVENTS.md) ------------


def _recipients(db: Session, request) -> list[str]:
    from app.services import request_visibility  # reason: services import this module

    try:
        return request_visibility.recipient_ids(db, request)
    except Exception as exc:  # noqa: BLE001 — never fail the request over who to tell
        logger.warning("live request recipients not resolved (%s)", type(exc).__name__)
        return []


def request_new(db: Session, request) -> None:
    """A question arrived in some inboxes. Queue BEFORE the commit (after the flush)."""
    emit(db, listeners=_recipients(db, request), ev={"t": "request.new", "id": request.id})


def request_gone(db: Session, request, *, also: Iterable[str | None] = ()) -> None:
    """A question left the inboxes it was in. Call BEFORE the change that takes it out of
    them (a broadcast stops matching the inbox rule once someone takes it); `also` adds
    mentors who should hear regardless (the one who just passed or took it)."""
    emit(
        db,
        listeners=[*_recipients(db, request), *also],
        ev={"t": "request.gone", "id": request.id},
    )


def request_changed(db: Session, request, status: str) -> None:
    """The asking member's own question changed status."""
    emit(
        db,
        members=[request.requester_id],
        ev={"t": "request.changed", "id": request.id, "status": status},
    )


def conversation_changed(
    db: Session | None, convo, *, member: bool = True, listener: bool = True
) -> None:
    """New, ended, snoozed, unread or waiting-on-you changed. With `db` it waits for the
    commit; with None it goes now (the change is already committed)."""
    kwargs = {
        "members": [convo.user_id] if member else [],
        "listeners": [convo.listener_id] if listener else [],
        "ev": {"t": "conversation.changed", "id": convo.id},
    }
    if db is None:
        publish(**kwargs)
    else:
        emit(db, **kwargs)


def review_decided(
    db: Session, *, member_id: str | None = None, listener_id: str | None = None
) -> None:
    """An application or verification review was decided for this identity."""
    emit(db, members=[member_id], listeners=[listener_id], ev={"t": "review.decided"})


def mentor_presence_changed(db: Session, listener_ids: Iterable[str]) -> None:
    """A mentor went online or away: the members of their ACTIVE conversations look again (chat
    header). Bounded by each mentor's few active chats; one query for all of them."""
    ids = [i for i in listener_ids if i]
    if not ids:
        return
    from sqlalchemy import select

    from app.models.conversation import Conversation
    from app.models.enums import ConversationStatus

    try:
        rows = db.execute(
            select(Conversation.id, Conversation.user_id).where(
                Conversation.listener_id.in_(ids),
                Conversation.status == ConversationStatus.active,
            )
        ).all()
    except Exception as exc:  # noqa: BLE001 — a hint, never a failure
        logger.warning("live presence recipients not resolved (%s)", type(exc).__name__)
        return
    for convo_id, user_id in rows:
        emit(db, members=[user_id], ev={"t": "conversation.changed", "id": convo_id})
