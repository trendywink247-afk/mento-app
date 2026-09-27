"""Push notifications (spec 2026-09-05-push-notifications-design.md).

Best-effort, never blocking: a push failure can never delay or degrade a
conversation, the crisis scan, or a request. Content is persona-only — no
message text ever leaves the chat path. Sends go to Expo's push API (FCM/APNs
relay) over httpx.

Where it runs (WS4): every entry point below runs in the job WORKER (app/jobs/tasks.py),
enqueued with the row that caused it — never inside a request. A notify_* job decides
(suppression rules) and tries once; a transport failure hands the send to a
`push.deliver` job that retries with backoff. The split matters: retrying the whole
notify job would trip its own burst window and suppress the retry.
"""

from __future__ import annotations

import logging

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import ratelimit
from app.config import get_settings
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, PushOwnerKind, VettingStatus
from app.models.listener import ListenerProfile
from app.models.push_token import PushToken
from app.models.request import ConversationRequest
from app.models.user import User
from app.services import snooze, stream

logger = logging.getLogger("mento.push")

# Test hook (like ratelimit.ENABLED): conftest forces False; push tests flip it True.
ENABLED: bool | None = None


def _enabled() -> bool:
    return ENABLED if ENABLED is not None else get_settings().push_enabled


def upsert_token(
    db: Session, kind: PushOwnerKind, owner_id: str, token: str, platform: str
) -> None:
    """One row per device token PER ROLE: re-point on reinstall, never duplicate; a
    device that is both a member and a mentor keeps one row for each role."""
    for attempt in (1, 2):
        existing = db.scalars(
            select(PushToken)
            .where(PushToken.expo_push_token == token, PushToken.owner_kind == kind)
            .limit(1)
        ).first()
        if existing is not None:
            existing.owner_id = owner_id
            existing.platform = platform
            if kind == PushOwnerKind.member:
                existing.user_id = owner_id
        else:
            db.add(
                PushToken(
                    user_id=owner_id,
                    owner_kind=kind,
                    owner_id=owner_id,
                    expo_push_token=token,
                    platform=platform,
                )
            )
        try:
            db.commit()
            return
        except IntegrityError:
            # The app registers on launch AND on focus — two calls raced to
            # uq_push_token_value_kind. The row exists now: go round once more and
            # take the re-point branch.
            db.rollback()
            if attempt == 2:
                raise


def delete_token(db: Session, kind: PushOwnerKind, owner_id: str, token: str) -> None:
    """Remove a device token, but only if the caller owns it (opaque no-op otherwise)."""
    row = db.scalars(
        select(PushToken).where(
            PushToken.expo_push_token == token,
            PushToken.owner_kind == kind,
            PushToken.owner_id == owner_id,
        )
    ).first()
    if row is not None:
        db.delete(row)
        db.commit()


def tokens_for(db: Session, kind: PushOwnerKind, owner_id: str) -> list[str]:
    return list(
        db.scalars(
            select(PushToken.expo_push_token).where(
                PushToken.owner_kind == kind, PushToken.owner_id == owner_id
            )
        ).all()
    )


EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
TITLE = "Mento"

# Closed template set — no free text ever enters a push (spec §5).
TEMPLATES = {
    "request": "Someone would like to talk with you",
    "accepted": "%(persona)s is ready to talk",
    "message_from_member": "%(persona)s sent a message",
    "message_from_listener": "%(persona)s replied",
}


def _is_watching(channel_id: str, user_id: str) -> bool:
    """True when `user_id` is currently watching the Stream channel (chat screen open).
    Cached briefly in Redis per channel; on any error assume NOT watching (send)."""
    key = f"push:watchers:{channel_id}"
    try:
        r = ratelimit._redis()
        cached = r.get(key)
        if cached is not None:
            # "".split(",") == [""] when no one is watching — harmless, since a
            # real user id is never the empty string.
            return user_id in cached.split(",")
    except Exception:
        pass
    client = stream._client()
    if client is None:
        return False
    try:
        # Stream only populates `watchers` in the query response when `state` is
        # requested (proven against the live API, session 31f) — state=False returns
        # an empty list and would silently disable this suppression rule.
        resp = client.channel("messaging", channel_id).query(
            watchers={"limit": 100}, state=True, presence=False
        )
        watchers = [w.get("id") for w in (resp.get("watchers") or []) if w.get("id")]
    except Exception as exc:  # noqa: BLE001 — best-effort by design
        logger.warning("watcher query failed (%s) — treating as not watching", type(exc).__name__)
        return False
    try:
        ratelimit._redis().set(key, ",".join(watchers), ex=get_settings().push_watch_cache_seconds)
    except Exception:
        pass
    return user_id in watchers


def _burst_open(conversation_id: str, recipient_id: str) -> bool:
    """One message push per recipient per conversation per window. Redis SET NX;
    on Redis error allow the send (fail open, like the rate limiter)."""
    try:
        return bool(
            ratelimit._redis().set(
                f"push:burst:{conversation_id}:{recipient_id}",
                "1",
                nx=True,
                ex=get_settings().push_burst_seconds,
            )
        )
    except Exception:
        return True


def _post_expo(messages: list[dict]) -> list[dict]:
    """POST a batch to Expo. Returns the per-message ticket list. Raises on transport errors."""
    resp = httpx.post(
        EXPO_PUSH_URL,
        json=messages,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        timeout=10.0,
    )
    resp.raise_for_status()
    return list((resp.json() or {}).get("data") or [])


class PushTransportError(Exception):
    """Expo could not be reached or answered badly — worth retrying later."""


def _post_or_raise(tokens: list[str], body: str, data: dict) -> list[dict]:
    messages = [
        {"to": t, "title": TITLE, "body": body, "sound": None, "data": data} for t in tokens
    ]
    try:
        return _post_expo(messages)
    except (httpx.HTTPError, ValueError) as exc:
        raise PushTransportError(type(exc).__name__) from exc


def _send(
    db: Session, kind: PushOwnerKind, owner_id: str, tokens: list[str], body: str, data: dict
) -> None:
    """One attempt now. On a transport failure the send becomes a retrying
    `push.deliver` job (committed here, best-effort) — never a sleep."""
    if not tokens or not _enabled():
        return
    try:
        tickets = _post_or_raise(tokens, body, data)
    except PushTransportError as exc:
        logger.warning("push send failed (%s) — queued for retry", exc)
        from app import jobs
        from app.jobs import tasks

        jobs.enqueue(
            db,
            tasks.push_deliver,
            best_effort=True,
            recipient_kind=kind.value,
            recipient_id=owner_id,
            body=body,
            data=data,
        )
        db.commit()
        return
    _forget_dead_tokens(db, tokens, tickets)


def deliver(db: Session, *, recipient_kind: str, recipient_id: str, body: str, data: dict) -> None:
    """The `push.deliver` retry job's body: re-read the recipient's CURRENT tokens (a
    device may have re-registered meanwhile) and send. Raises PushTransportError so
    the queue retries with backoff; the suppression rules already ran."""
    if not _enabled():
        return
    tokens = tokens_for(db, PushOwnerKind(recipient_kind), recipient_id)
    if not tokens:
        _suppressed("no_token")
        return
    _forget_dead_tokens(db, tokens, _post_or_raise(tokens, body, data))


def _forget_dead_tokens(db: Session, tokens: list[str], tickets: list[dict]) -> None:
    dead = [
        t
        for t, ticket in zip(tokens, tickets)
        if ticket.get("status") == "error"
        and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered"
    ]
    if dead:
        for row in db.scalars(select(PushToken).where(PushToken.expo_push_token.in_(dead))).all():
            db.delete(row)
        db.commit()
    logger.info("push sent=%d dead=%d", len(tickets), len(dead))


def _listener_ok(db: Session, listener_id: str) -> bool:
    li = db.get(ListenerProfile, listener_id)
    return li is not None and li.vetting_status == VettingStatus.approved


def _suppressed(reason: str) -> None:
    """Spec §4: log the reason as a counter, never the ids."""
    logger.info("push suppressed reason=%s", reason)


def notify_message(db: Session, *, conversation_id: str, sender_stream_user_id: str) -> None:
    """message.new → push the OTHER party unless suppressed (spec §4).

    Callers must commit their own state before calling — `_send` may itself
    commit (dead-token cleanup).
    """
    convo = db.get(Conversation, conversation_id)
    if convo is None or convo.status != ConversationStatus.active or not convo.stream_channel_id:
        _suppressed("not_active")
        return
    if sender_stream_user_id == convo.user_id:
        recipient_kind, recipient_id = PushOwnerKind.listener, convo.listener_id
        persona = db.get(User, convo.user_id)
        body = TEMPLATES["message_from_member"] % {
            "persona": persona.persona_name if persona else "Someone"
        }
    elif sender_stream_user_id == convo.listener_id:
        recipient_kind, recipient_id = PushOwnerKind.member, convo.user_id
        li = db.get(ListenerProfile, convo.listener_id)
        body = TEMPLATES["message_from_listener"] % {
            "persona": li.persona_name if li else "Your mentor"
        }
    else:
        _suppressed("not_party")
        return
    tokens = tokens_for(db, recipient_kind, recipient_id)
    if not tokens:
        _suppressed("no_token")
        return
    if recipient_kind == PushOwnerKind.listener and not _listener_ok(db, recipient_id):
        _suppressed("listener_not_approved")
        return
    if _is_watching(convo.stream_channel_id, recipient_id):
        _suppressed("watching")
        return
    if recipient_kind == PushOwnerKind.listener and snooze.is_snoozed(convo):
        # The mentor snoozed this chat ("I can't reply today"). A crisis-flagged
        # member message has already ended the snooze in the Stream hook, so this
        # can never silence one.
        _suppressed("snoozed")
        return
    if recipient_kind == PushOwnerKind.member and convo.is_paused:
        _suppressed("paused")
        return
    if not _burst_open(convo.id, recipient_id):
        _suppressed("burst")
        return
    _send(
        db,
        recipient_kind,
        recipient_id,
        tokens,
        body,
        {
            "kind": "message",
            "conversation_id": convo.id,
            "stream_channel_id": convo.stream_channel_id,
        },
    )


def notify_request_created(db: Session, *, request_id: str) -> None:
    """Callers must commit their own state before calling — `_send` may itself
    commit (dead-token cleanup)."""
    req = db.get(ConversationRequest, request_id)
    if req is None or not req.target_listener_id:
        if req is not None:
            _suppressed("no_target")
        return
    if not _listener_ok(db, req.target_listener_id):
        _suppressed("listener_not_approved")
        return
    tokens = tokens_for(db, PushOwnerKind.listener, req.target_listener_id)
    if not tokens:
        _suppressed("no_token")
        return
    _send(
        db,
        PushOwnerKind.listener,
        req.target_listener_id,
        tokens,
        TEMPLATES["request"],
        {"kind": "request", "request_id": req.id},
    )


def notify_request_accepted(db: Session, *, request_id: str) -> None:
    """Callers must commit their own state before calling — `_send` may itself
    commit (dead-token cleanup)."""
    req = db.get(ConversationRequest, request_id)
    if req is None or not req.conversation_id:
        return
    convo = db.get(Conversation, req.conversation_id)
    li = db.get(ListenerProfile, req.target_listener_id) if req.target_listener_id else None
    if convo is None or li is None:
        _suppressed("no_conversation")
        return
    tokens = tokens_for(db, PushOwnerKind.member, req.requester_id)
    if not tokens:
        _suppressed("no_token")
        return
    _send(
        db,
        PushOwnerKind.member,
        req.requester_id,
        tokens,
        TEMPLATES["accepted"] % {"persona": li.persona_name},
        {
            "kind": "accepted",
            "conversation_id": convo.id,
            "stream_channel_id": convo.stream_channel_id,
        },
    )


def notify_message_for_channel(db: Session, *, channel_id: str, sender_stream_user_id: str) -> None:
    """The `push.message` job's body: resolve channel → conversation, then notify."""
    cid = db.execute(
        select(Conversation.id).where(Conversation.stream_channel_id == channel_id)
    ).scalar_one_or_none()
    if cid:
        notify_message(db, conversation_id=cid, sender_stream_user_id=sender_stream_user_id)
