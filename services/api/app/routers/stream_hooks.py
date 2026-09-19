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
from datetime import UTC, datetime

import anyio.to_thread
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response, status
from sqlalchemy import select

from app.config import get_settings
from app.db import SessionLocal
from app.models.conversation import Conversation
from app.models.enums import SafetySignal
from app.services import crisis, moderation, push, safety, stream
from app.services.crisis import CrisisResult
from app.services.moderation import RedactionResult

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


async def _run_redact(text: str) -> RedactionResult:
    """Run PII redaction off the event loop (optional NER can be non-trivial), under
    the same isolated limiter so it can't starve behind unrelated sync traffic."""
    return await anyio.to_thread.run_sync(
        lambda: moderation.redact(text), limiter=_get_crisis_limiter()
    )


def _record_redaction(types: list[str]) -> None:
    """Best-effort, signal-only telemetry for the admin health view. NEVER the body
    or the redacted content (Trust & Safety #6) — just which categories fired."""
    try:
        from app import ratelimit

        r = ratelimit._redis()
        r.incr("mento:pii_redactions_total")
        for t in types:
            r.incr(f"mento:pii_redactions:{t}")
    except Exception:
        pass
    logger.info("pii_redacted types=%s", ",".join(types))


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

    verified = stream.verify_webhook(payload, signature) or (
        # Fallback: a setup that signs the raw (compressed) bytes.
        payload is not raw
        and stream.verify_webhook(raw, signature)
    )
    if not verified:
        logger.warning("Stream webhook signature verification FAILED — rejecting")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid webhook signature")
    try:
        event = json.loads(payload)
    except ValueError:
        # Signed but unparseable: a 500 here would make Stream retry it forever.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "malformed webhook body") from None
    if not isinstance(event, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "malformed webhook body")
    return event


def _stamp_webhook_seen() -> None:
    """Stamp last-webhook time so the admin Health tab and /health/crisis can detect a
    silently-dead crisis webhook. Best-effort — a Redis outage must never break the
    scan path."""
    try:
        from app import ratelimit

        ratelimit._redis().set("mento:last_webhook_at", datetime.now(UTC).isoformat())
    except Exception:
        pass


def _scan_event(
    *, text: str, user_id: str, channel_id: str | None, message_id: str | None
) -> CrisisResult:
    """The blocking work for one webhook event. Runs in the threadpool: these handlers
    are async (the body read must be awaited), and sync DB calls on the event loop
    would stall every other request while Stream waits on the hot per-message path.

    Scan FIRST, database second. The lexical scan is pure, so an ordinary message
    costs no DB round trip at all, and a crisis message is recognised even when
    Postgres is unreachable. Only a triggered signal opens a session — ONE session
    for both the channel lookup and the flag write. A DB failure propagates: the
    sync hook degrades to the card without the flag (see before_message_send), the
    async hook answers 5xx so Stream retries it."""
    _stamp_webhook_seen()
    if not crisis.scan(text).triggered:
        return CrisisResult(triggered=False, signal=SafetySignal.none)
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


async def _scan_or_degrade(
    *, text: str, user_id: str, channel_id: str | None, message_id: str | None
) -> CrisisResult:
    """Sync-hook scan that can never lose the helpline card to an infra fault.

    Stream fails OPEN on a non-2xx from us — the message would be delivered exactly
    as sent, with no `crisis` payload. So if persisting the flag fails (DB down, pool
    exhausted) we fall back to the pure scan and still augment the message. Never
    silent: logged at ERROR; the retried async `message.new` hook writes the flag
    for the human-review queue once the database is back."""
    try:
        return await _run_scan(
            text=text, user_id=user_id, channel_id=channel_id, message_id=message_id
        )
    except Exception as exc:  # noqa: BLE001 — the card must survive any fault
        logger.error(
            "crisis flag NOT persisted in before-send hook (%s) — returning the "
            "helpline card anyway; the async message.new hook will retry the flag",
            type(exc).__name__,
        )
        return crisis.scan(text)


@router.post("/before-message-send")
async def before_message_send(request: Request) -> dict:
    """Synchronous enforcement: scan before Stream delivers the message."""
    event = await _verified_event(request)
    message = event.get("message") or {}
    text = message.get("text") or ""
    message_id = message.get("id")
    user_id = (event.get("user") or message.get("user") or {}).get("id") or "unknown"
    channel_id = (event.get("channel") or {}).get("id")

    # Crisis scan reads the ORIGINAL text (signals aren't PII; redaction must not blind
    # it). Redaction rewrites what the recipient actually receives.
    result = await _scan_or_degrade(
        text=text, user_id=user_id, channel_id=channel_id, message_id=message_id
    )
    redaction = await _run_redact(text)

    if result.triggered or redaction.redacted:
        # Return the (possibly redacted) text so partial-update semantics can't drop
        # the body; attach a crisis and/or moderation payload the client renders.
        message_out: dict = {"text": redaction.text}
        if result.triggered:
            message_out["crisis"] = {
                "support": safety.SUPPORT_COPY,
                "signal": result.signal.value,
                "helplines": result.helplines,
            }
        if redaction.redacted:
            message_out["moderation"] = {"redacted": True, "types": redaction.types}
            _record_redaction(redaction.types)
        return {"message": message_out}
    # Allow unchanged.
    return {}


@router.post("/webhook")
async def push_webhook(request: Request, background: BackgroundTasks) -> Response:
    """Async safety net: re-scan message.new events (retried by Stream on recovery),
    then schedule the push to the other party (best-effort, after the scan)."""
    event = await _verified_event(request)
    if event.get("type") == "message.new":
        message = event.get("message") or {}
        channel_id = (event.get("channel") or {}).get("id") or event.get("channel_id")
        sender_id = (message.get("user") or {}).get("id") or "unknown"
        await _run_scan(
            text=message.get("text") or "",
            user_id=sender_id,
            channel_id=channel_id,
            message_id=message.get("id"),
        )
        if channel_id:
            background.add_task(push.notify_message_safe, channel_id, sender_id)
    return Response(status_code=status.HTTP_200_OK)
