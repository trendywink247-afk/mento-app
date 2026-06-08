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
"""
from __future__ import annotations

import gzip
import json
import logging

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from app.db import SessionLocal
from app.models.conversation import Conversation
from app.services import safety, stream

logger = logging.getLogger("mento.stream_hooks")
router = APIRouter(prefix="/stream", tags=["stream"])


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


def _conversation_id_for(channel_id: str | None) -> str | None:
    if not channel_id:
        return None
    with SessionLocal() as db:
        return db.execute(
            select(Conversation.id).where(Conversation.stream_channel_id == channel_id)
        ).scalar_one_or_none()


@router.post("/before-message-send")
async def before_message_send(request: Request) -> dict:
    """Synchronous enforcement: scan before Stream delivers the message."""
    event = await _verified_event(request)
    message = event.get("message") or {}
    text = message.get("text") or ""
    message_id = message.get("id")
    user_id = (event.get("user") or message.get("user") or {}).get("id") or "unknown"
    channel_id = (event.get("channel") or {}).get("id")

    with SessionLocal() as db:
        result = safety.scan_and_flag(
            db,
            text=text,
            user_id=user_id,
            conversation_id=_conversation_id_for(channel_id),
            stream_message_id=message_id,
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
        with SessionLocal() as db:
            safety.scan_and_flag(
                db,
                text=message.get("text") or "",
                user_id=(message.get("user") or {}).get("id") or "unknown",
                conversation_id=_conversation_id_for(channel_id),
                stream_message_id=message.get("id"),
            )
    return Response(status_code=status.HTTP_200_OK)
