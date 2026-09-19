"""Own-chat transport (spike/own-chat): WebSocket + history REST.

  WS   /chat/ws/{conversation_id}   first frame {"t":"hello","token","after"} (auth is a
                                    frame, not a URL param, so tokens stay out of logs)
       client → server:  send{client_id,text} · typing{on} · read{seq} · ping
       server → client:  hello · message · held · typing · read · presence · wiped · error
  GET  /chat/{id}/messages?after=   catch-up / first load, either side (bearer)
  POST /chat/{id}/wipe              Clean Wipe: bodies deleted from our database

Dev-only (ENV=dev): POST /chat/spike/session, GET /chat/spike/demo.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import TypeVar

import anyio.to_thread
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse
from jose import JWTError, jwt

from app.chat_hub import hub
from app.config import get_settings
from app.db import SessionLocal
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import (
    _ALGO,
    _signing_secret,
    current_member_or_listener,
    issue_listener_token,
    issue_session_token,
)
from app.services import chat

logger = logging.getLogger("mento.chat.router")
router = APIRouter(tags=["chat"])
T = TypeVar("T")

_HELLO_TIMEOUT_S = 5.0


async def _db(fn: Callable[..., T], *args) -> T:
    """Run a sync, Session-based service call on a worker thread."""

    def _run() -> T:
        with SessionLocal() as db:
            return fn(db, *args)

    return await anyio.to_thread.run_sync(_run)


def _identify(token: str | None) -> str | None:
    """Member or mentor id from a session JWT; None if invalid. Admin tokens never work."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, _signing_secret("user"), algorithms=[_ALGO])
    except JWTError:
        return None
    if payload.get("role") not in ("user", None, "listener"):
        return None
    return payload.get("sub")


def _load(db, conversation_id: str) -> Conversation | None:
    return db.get(Conversation, conversation_id)


@router.websocket("/chat/ws/{conversation_id}")
async def chat_ws(ws: WebSocket, conversation_id: str) -> None:
    await ws.accept()
    try:
        first = await asyncio.wait_for(ws.receive_json(), _HELLO_TIMEOUT_S)
    except (TimeoutError, WebSocketDisconnect, ValueError):
        await ws.close(code=4400)
        return
    me = _identify(first.get("token")) if first.get("t") == "hello" else None
    convo = await _db(_load, conversation_id) if me else None
    side = chat.side_of(convo, me) if convo and me else None
    if side is None or not chat.is_open(convo):
        await ws.close(code=4403)  # same answer for "no such chat" and "not yours"
        return
    peer_id = convo.listener_id if side == "member" else convo.user_id

    await hub.join(conversation_id, ws, me)
    try:
        after = int(first.get("after") or 0)
        last = await _db(chat.last_seq, conversation_id)
        await ws.send_json(
            {
                "t": "hello",
                "side": side,
                "last_seq": last,
                "peer_online": await hub.is_connected(conversation_id, peer_id),
                "read": await _db(chat.read_markers, conversation_id),
            }
        )
        for m in await _db(chat.history, conversation_id, after):
            await ws.send_json({"t": "message", "message": m})
        await hub.publish(conversation_id, {"t": "presence", "user": me, "online": True, "_skip": me})

        while True:
            frame = await ws.receive_json()
            kind = frame.get("t")
            if kind == "send":
                await _on_send(ws, conversation_id, me, frame)
            elif kind == "typing":
                await hub.publish(
                    conversation_id,
                    {"t": "typing", "from": me, "on": bool(frame.get("on")), "_skip": me},
                )
            elif kind == "read":
                marker = await _db(chat.mark_read, conversation_id, me, int(frame.get("seq") or 0))
                await hub.publish(conversation_id, {"t": "read", "by": me, "seq": marker})
            elif kind == "ping":
                await hub.touch(conversation_id)
                await ws.send_json({"t": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 — one bad frame closes one socket, never the process
        logger.exception("chat socket error")
    finally:
        await hub.leave(conversation_id, ws)
        if not await hub.is_connected(conversation_id, me):
            await hub.publish(
                conversation_id, {"t": "presence", "user": me, "online": False, "_skip": me}
            )


async def _on_send(ws: WebSocket, conversation_id: str, me: str, frame: dict) -> None:
    client_id = str(frame.get("client_id") or "")[:64]
    if not client_id:
        await ws.send_json({"t": "error", "code": "client_id_required"})
        return

    def _send(db):
        convo = db.get(Conversation, conversation_id)
        if convo is None or not chat.is_open(convo):
            return None
        return chat.send(db, convo, me, str(frame.get("text") or ""), client_id)

    try:
        sent = await _db(_send)
    except ValueError:
        await ws.send_json({"t": "error", "code": "empty", "client_id": client_id})
        return
    if sent is None:
        await ws.send_json({"t": "error", "code": "ended", "client_id": client_id})
        return
    if sent.held is not None:
        await ws.send_json({"t": "held", "client_id": client_id, "allowance": sent.held})
        return
    if not sent.duplicate:  # a retried send is acked to the retrier only, not re-broadcast
        await hub.publish(conversation_id, {"t": "message", "message": sent.message})
    else:
        await ws.send_json({"t": "message", "message": sent.message})


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
async def wipe(conversation_id: str, who=Depends(current_member_or_listener)) -> dict:
    if who[0] != "member":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "members only")

    def _wipe(db):
        convo = db.get(Conversation, conversation_id)
        if convo is None or convo.user_id != who[1]:
            return None
        return chat.wipe(db, conversation_id)

    deleted = await _db(_wipe)
    if deleted is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no such conversation")
    await hub.publish(conversation_id, {"t": "wiped"})
    return {"deleted": deleted}


# ---- dev-only: seed a conversation so the demo page and the bench need no onboarding ----
def _dev_only() -> None:
    if get_settings().env != "dev":
        raise HTTPException(status.HTTP_404_NOT_FOUND)


@router.post("/chat/spike/session")
def spike_session() -> dict:
    _dev_only()
    with SessionLocal() as db:
        u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
        li = ListenerProfile(
            persona_name="Open River",
            persona_avatar="river",
            categories=[],
            status=ListenerStatus.online,
            vetting_status=VettingStatus.approved,
            rank=10,
            active_conversations=1,
            max_concurrent=3,
        )
        db.add_all([u, li])
        db.flush()
        c = Conversation(
            type="anon",
            status=ConversationStatus.active,
            user_id=u.id,
            listener_id=li.id,
        )
        db.add(c)
        db.flush()
        c.stream_channel_id = c.id  # the opaque channel key the allowance/snooze look up by
        db.commit()
        return {
            "conversation_id": c.id,
            "member": {"id": u.id, "token": issue_session_token(u.id)},
            "mentor": {"id": li.id, "token": issue_listener_token(li.id)},
        }


@router.get("/chat/spike/demo", include_in_schema=False)
def spike_demo() -> FileResponse:
    _dev_only()
    return FileResponse(Path(__file__).resolve().parents[2] / "spike" / "chat_demo.html")
