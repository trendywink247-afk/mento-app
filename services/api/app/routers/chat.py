"""Own-chat transport (WS5 T5.1, from `spike/own-chat`): WebSocket + history REST.

  WS   /chat/ws/{conversation_id}   first frame {"t":"hello","token","after"} (auth is a
                                    frame, not a URL param, so tokens stay out of logs)
       client → server:  send{client_id,text} · typing{on} · read{seq} · ping
       server → client:  hello · message · held · typing · read · presence · wiped · error
  GET  /chat/{id}/messages?after=   catch-up / first load, either side (bearer)
  POST /chat/{id}/wipe              Clean Wipe: bodies deleted from our database

Nothing user-facing uses this yet: chat still runs on Stream until the cutover (T5.10).
The spike's dev-only session seeder and demo page were deliberately not brought over —
they mint tokens, and a mis-set ENV would expose that.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import Callable
from typing import TypeVar

import anyio.to_thread
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.security import HTTPAuthorizationCredentials

from app import ratelimit
from app.chat_hub import Peer, hub
from app.config import get_settings
from app.db import SessionLocal
from app.models.conversation import Conversation
from app.models.enums import ConversationEndedBy
from app.security import current_member_or_listener
from app.services import chat, conversations

logger = logging.getLogger("mento.chat.router")
router = APIRouter(tags=["chat"])
T = TypeVar("T")

_HELLO_TIMEOUT_S = 5.0
# Frames bigger than this close the socket (1009). uvicorn enforces the same number at
# the protocol layer (`--ws-max-size 16384`, docker-entrypoint.sh); this check keeps it
# true under any launcher.
MAX_FRAME_BYTES = 16 * 1024
CLOSE_TOO_BIG = 1009
CLOSE_IDLE = 4408


async def _db(fn: Callable[..., T], *args, **kwargs) -> T:
    """Run a sync, Session-based service call on a worker thread."""

    def _run() -> T:
        with SessionLocal() as db:
            return fn(db, *args, **kwargs)

    return await anyio.to_thread.run_sync(_run)


def _identify(token: object) -> str | None:
    """Member or mentor id from a session JWT; None if invalid. The same check as the
    HTTP routes (`security.current_member_or_listener`): signature per role, expiry,
    iss/aud, legacy windows. Admin tokens never work."""
    if not isinstance(token, str) or not token:
        return None
    try:
        _, subject = current_member_or_listener(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        )
    except HTTPException:
        return None
    return subject


@router.websocket("/chat/ws/{conversation_id}")
async def chat_ws(ws: WebSocket, conversation_id: str) -> None:
    await ws.accept()
    try:
        first = json.loads(await asyncio.wait_for(ws.receive_text(), _HELLO_TIMEOUT_S))
    except (TimeoutError, WebSocketDisconnect, ValueError):
        await _close(ws, 4400)
        return
    first = first if isinstance(first, dict) else {}
    me = _identify(first.get("token")) if first.get("t") == "hello" else None
    if me is None:
        await _close(ws, 4403)
        return
    try:
        after = max(0, int(first.get("after") or 0))
    except (TypeError, ValueError):
        after = 0

    # Registered (paused) BEFORE the snapshot, so nothing published in between is lost;
    # the writer skips what the replay carries (hub docstring).
    peer = hub.join(conversation_id, ws, me)
    try:
        opened = await _db(chat.opening, conversation_id, me, after)
        if opened is None:
            await hub.leave(conversation_id, ws)
            await _close(ws, 4403)  # same answer for "no such chat", "not yours", "ended"
            return
        await ws.send_json(
            {
                "t": "hello",
                "side": opened.side,
                "last_seq": opened.last_seq,
                "peer_online": await hub.is_connected(conversation_id, opened.peer_id),
                "read": opened.read,
            }
        )
        for m in opened.replay:
            await ws.send_json({"t": "message", "message": m})
        replayed_to = opened.replay[-1]["seq"] if opened.replay else after
        await hub.arrive(conversation_id, peer, max(after, replayed_to))
        await hub.publish(
            conversation_id, {"t": "presence", "user": me, "online": True, "_skip": me}
        )

        settings = get_settings()
        while not peer.closed:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), settings.chat_idle_deadline_s)
            except TimeoutError:
                await _close(ws, CLOSE_IDLE)  # no ping in time: a dead or frozen client
                return
            if len(raw.encode("utf-8")) > MAX_FRAME_BYTES:
                await _close(ws, CLOSE_TOO_BIG)
                return
            try:
                frame = json.loads(raw)
            except ValueError:
                hub.send_to(peer, {"t": "error", "code": "bad_frame"})
                continue
            if not isinstance(frame, dict):
                hub.send_to(peer, {"t": "error", "code": "bad_frame"})
                continue
            kind = frame.get("t")
            if kind == "ping":
                await hub.touch(conversation_id)
                hub.send_to(peer, {"t": "pong"})
                continue
            if not await _within_rate(me):
                hub.send_to(
                    peer,
                    {"t": "error", "code": "rate_limited", "client_id": frame.get("client_id")},
                )
                continue
            if kind == "send":
                await _on_send(peer, conversation_id, me, frame)
            elif kind == "typing":
                await hub.publish(
                    conversation_id,
                    {"t": "typing", "from": me, "on": bool(frame.get("on")), "_skip": me},
                )
            elif kind == "read":
                try:
                    seq = int(frame.get("seq") or 0)
                except (TypeError, ValueError):
                    continue
                marker = await _db(chat.mark_read, conversation_id, me, seq)
                await hub.publish(conversation_id, {"t": "read", "by": me, "seq": marker})
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 — one bad frame closes one socket, never the process
        logger.exception("chat socket error")
    finally:
        was_present = peer.present
        await hub.leave(conversation_id, ws)
        if was_present and not await hub.is_connected(conversation_id, me):
            await hub.publish(
                conversation_id, {"t": "presence", "user": me, "online": False, "_skip": me}
            )


async def _close(ws: WebSocket, code: int) -> None:
    with contextlib.suppress(Exception):
        await ws.close(code=code)


async def _within_rate(me: str) -> bool:
    """Per-person frame budget across all their sockets (`chat:{user}`). Fails open,
    like every chat limit (ratelimit.py) — off the event loop, since Valkey may hang."""
    s = get_settings()
    return await anyio.to_thread.run_sync(
        ratelimit.allow, f"chat:{me}", s.chat_frames_per_window, s.chat_frames_window_s
    )


async def _on_send(peer: Peer, conversation_id: str, me: str, frame: dict) -> None:
    """Hand the frame to the one write path. `chat.send` publishes the stored message
    to the room itself (this socket included); only the answers meant for the sender
    alone — held, a retried send's ack, a refusal — are sent from here."""
    client_id = str(frame.get("client_id") or "")[:64]
    body = frame.get("text")
    try:
        sent = await _db(chat.send, me, conversation_id, client_id=client_id, body=str(body or ""))
    except chat.NotAllowed as refused:
        hub.send_to(peer, {"t": "error", "code": refused.code, "client_id": client_id})
        return
    if sent.held is not None:
        hub.send_to(peer, {"t": "held", "client_id": client_id, "allowance": sent.held})
    elif sent.duplicate:  # a retried send is acked to the retrier only, not re-broadcast
        hub.send_to(peer, {"t": "message", "message": sent.message})


@router.get("/chat/{conversation_id}/messages")
def messages(conversation_id: str, after: int = 0, who=Depends(current_member_or_listener)) -> dict:
    with SessionLocal() as db:
        convo = db.get(Conversation, conversation_id)
        if convo is None or chat.side_of(convo, who[1]) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such conversation")
        return {
            "messages": chat.history(db, conversation_id, after),
            "last_seq": chat.last_seq(db, conversation_id),
        }


@router.post("/chat/{conversation_id}/wipe")
def wipe(conversation_id: str, who=Depends(current_member_or_listener)) -> dict:
    """Clean Wipe for an own-chat conversation — the same service as
    POST /conversations/{id}/wipe (services/conversations.clean_wipe): bodies deleted,
    the chat ended, the sockets told `wiped` then `ended` once it commits."""
    if who[0] != "member":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "members only")
    with SessionLocal() as db:
        convo = conversations.lock(db, conversation_id)
        if convo is None or convo.user_id != who[1]:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such conversation")
        deleted = conversations.clean_wipe(db, convo, ConversationEndedBy.member)
        db.commit()
    return {"deleted": deleted}
