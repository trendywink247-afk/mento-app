"""Stream Chat webhooks — the server-side, un-bypassable crisis-scan enforcement.

Stream calls these endpoints server-to-server for EVERY message, regardless of which
client sent it (mobile UI, a script, the Stream API directly). That is what makes the
crisis scan impossible to route around from the client (Trust & Safety #1, PRD §10).

Two endpoints:
  POST /stream/before-message-send  — SYNCHRONOUS enforcement. Stream waits for our
      response before delivering. We scan, persist the signal, and augment the message
      with a `crisis` custom field (support copy + helplines) the client renders.
  POST /stream/webhook              — ASYNC push events (message.new). Stream RETRIES
      this on failure and resumes when our service is healthy again, so any message
      that slipped past the (fail-open) before-send hook during an outage is re-scanned
      here. This is what keeps the fail-open behaviour from being a *silent* bypass.

Fail-mode (documented in CLAUDE.md): if this service is down/slow, Stream fails OPEN
(delivers the message) — we never permanently hard-block a support conversation. The
async message.new retry guarantees the scan still runs on recovery, so no message
escapes scanning permanently.

Replay protection (A5, deliberate design): there is NO timestamp-window rejection on
/webhook. Stream legitimately retries old events after an outage — rejecting "stale"
events would break the fail-open safety net. Instead, replays are made harmless by
dedupe: safety.scan_and_flag skips (and a unique index on
safety_flags.stream_message_id race-proofs) any message id already flagged, so a
replayed identical webhook can never double-flag. Proven by
tests/test_stream_webhook.py::test_replayed_webhook_does_not_double_flag.
"""
from __future__ import annotations

import gzip
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

import anyio.to_thread

from app.config import get_settings
from app.db import SessionLocal
from app.models.conversation import Conversation
from app.services import safety, stream
from app.services.crisis import CrisisResult

logger = logging.getLogger("mento.stream_hooks")
router = APIRouter(prefix="/stream", tags=["stream"])

# Dedicated thread budget for the crisis scan. run_in_threadpool would share the
# default ~40-thread anyio pool with EVERY other sync handler in the app — a burst
# of slow sync endpoints could starve the safety scan (the flagship guarantee).
# A private CapacityLimiter isolates it: crisis scans queue only behind other
# crisis scans, never behind unrelated traffic. Created lazily — CapacityLimiter
# needs a running event loop on some anyio versions.
_crisis_limiter: anyio.CapacityLimiter | None = None


def _get_crisis_limiter() -> anyio.CapacityLimiter:
    global _crisis_limiter
    if _crisis_limiter is None:
        _crisis_limiter = anyio.CapacityLimiter(get_settings().crisis_scan_threads)
    return _crisis_limiter


async def _run_scan(**kwargs) -> CrisisResult:
    """Run _scan_event on a worker thread under the dedicated crisis limiter."""
    return await anyio.to_thread.run_sync(
        lambda: _scan_event(**kwargs), limiter=_get_crisis_limiter()
    )


async def _verified_event(request: Request) -> dict:
    """Read + signature-verify a Stream webhook body, or 401. Never trust an unverified
    request — an unsigned/forged call must not drive (or skip) the safety scan.

    Stream gzip-compresses webhook bodies and signs the DECOMPRESSED JSON, so we verify
    over the decompressed payload (with a fallback to the raw bytes for robustness)."""
    raw = await request.body()
    signature = request.headers.get("x-signature")

    payload = raw
    if "gzip" in (request.headers.get("content-encoding") or "").lower():
        try:
            payload = gzip.decompress(raw)
        except OSError:
            payload = raw

    if stream.verify_webhook(payload, signature):
        return json.loads(payload)
    # Fallback: a setup that signs the raw (compressed) bytes.
    if payload is not raw and stream.verify_webhook(raw, signature):
        return json.loads(payload)

    logger.warning("Stream webhook signature verification FAILED — rejecting")
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid webhook signature")


def _scan_event(
    *, text: str, user_id: str, channel_id: str | None, message_id: str | None
) -> CrisisResult:
    """The blocking DB work for one webhook event — ONE session for both the channel
    lookup and the flag write. Runs in the threadpool: these handlers are async (the
    body read must be awaited), and sync DB calls on the event loop would stall every
    other request while Stream waits on the hot per-message path."""
    # Stamp last-webhook time so the admin Health tab can detect a silently-dead
    # crisis webhook. Best-effort — a Redis outage must never break the scan path.
    try:
        from app import ratelimit

        ratelimit._redis().set(
            "mento:last_webhook_at", datetime.now(timezone.utc).isoformat()
        )
    except Exception:
        pass
    with SessionLocal() as db:
        conversation_id = None
        if channel_id:
            conversation_id = db.execute(
                select(Conversation.id).where(Conversation.stream_channel_id == channel_id)
            ).scalar_one_or_none()
        return safety.scan_and_flag(
            db,
            text=text,
            user_id=user_id,
            conversation_id=conversation_id,
            stream_message_id=message_id,
        )


@router.post("/before-message-send")
async def before_message_send(request: Request) -> dict:
    """Synchronous enforcement: scan before Stream delivers the message."""
    event = await _verified_event(request)
    message = event.get("message") or {}
    text = message.get("text") or ""
    message_id = message.get("id")
    user_id = (event.get("user") or message.get("user") or {}).get("id") or "unknown"
    channel_id = (event.get("channel") or {}).get("id")

    result = await _run_scan(
        text=text, user_id=user_id, channel_id=channel_id, message_id=message_id
    )

    if result.triggered:
        # Augment the message with a crisis payload the client renders as the helpline
        # card. Echo `text` so partial-update semantics can't drop the original body.
        return {
            "message": {
                "text": text,
                "crisis": {
                    "support": safety.SUPPORT_COPY,
                    "signal": result.signal.value,
                    "helplines": result.helplines,
                },
            }
        }
    # Allow unchanged.
    return {}


@router.post("/webhook")
async def push_webhook(request: Request) -> Response:
    """Async safety net: re-scan message.new events (retried by Stream on recovery)."""
    event = await _verified_event(request)
    if event.get("type") == "message.new":
        message = event.get("message") or {}
        channel_id = (event.get("channel") or {}).get("id") or event.get("channel_id")
        await _run_scan(
            text=message.get("text") or "",
            user_id=(message.get("user") or {}).get("id") or "unknown",
            channel_id=channel_id,
            message_id=message.get("id"),
        )
    return Response(status_code=status.HTTP_200_OK)
