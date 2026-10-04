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
from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app import ratelimit
from app.chat_hub import Peer, hub
from app.config import get_settings
from app.db import SessionLocal, get_db
from app.errors import ApiProblem
from app.models.conversation import Conversation
from app.models.enums import ConversationEndedBy, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import _bearer, current_member_or_listener, current_user_id
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
AUTH_RECHECK_S = 15.0


async def _db(fn: Callable[..., T], *args, **kwargs) -> T:
    """Run a sync, Session-based service call on a worker thread."""

    def _run() -> T:
        with SessionLocal() as db:
            return fn(db, *args, **kwargs)

    return await anyio.to_thread.run_sync(_run)


def _authorized_identity(db: Session, creds: HTTPAuthorizationCredentials) -> tuple[str, str]:
    """Token role plus live account standing, for every own-chat read and socket."""
    role, subject = current_member_or_listener(creds)
    if role == "member":
        current_user_id(creds, db)
        if db.get(User, subject) is None:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown session")
    else:
        mentor = db.get(ListenerProfile, subject)
        if mentor is None or mentor.vetting_status != VettingStatus.approved:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "listener access revoked")
    return role, subject


def _current_chat_identity(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    db: Session = Depends(get_db),
) -> tuple[str, str]:
    return _authorized_identity(db, creds)


def _token_identity(token: object) -> tuple[str, str] | None:
    """Member or mentor id from a session JWT; None if invalid. The same check as the
    HTTP routes (`security.current_member_or_listener`): signature per role, expiry,
    iss/aud, legacy windows. Admin tokens never work."""
    if not isinstance(token, str) or not token:
        return None
    try:
        who = current_member_or_listener(
            HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        )
    except (HTTPException, ApiProblem):
        return None
    return who


def _identify(db: Session, token: object) -> tuple[str, str] | None:
    if not isinstance(token, str) or not token:
        return None
    try:
        return _authorized_identity(
            db, HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
        )
    except (HTTPException, ApiProblem):
        return None


def _authorized_opening(db: Session, conversation_id: str, token: object, who, after: int):
    """One database round for standing and replay after the paused subscription."""
    if _identify(db, token) != who:
        return None
    convo = db.get(Conversation, conversation_id)
    if convo is None or chat.side_of(convo, who[1]) != who[0]:
        return None
    return chat.opening(db, conversation_id, who[1], after)


@router.websocket("/chat/ws/{conversation_id}")
async def chat_ws(ws: WebSocket, conversation_id: str) -> None:
    await ws.accept()
    try:
        first = json.loads(await asyncio.wait_for(ws.receive_text(), _HELLO_TIMEOUT_S))
    except (TimeoutError, WebSocketDisconnect, ValueError):
        await _close(ws, 4400)
        return
    first = first if isinstance(first, dict) else {}
    token = first.get("token")
    who = _token_identity(token) if first.get("t") == "hello" else None
    if who is None:
        await _close(ws, 4403)
        return
    role, me = who
    try:
        after = max(0, int(first.get("after") or 0))
    except (TypeError, ValueError):
        after = 0

    # Registered (paused) BEFORE the snapshot, so nothing published in between is lost;
    # the writer skips what the replay carries (hub docstring).
    peer = hub.join(conversation_id, ws, me)
    try:
        opened = await _db(_authorized_opening, conversation_id, token, who, after)
        if opened is None or opened.side != role:
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
        last_frame_at = asyncio.get_running_loop().time()
        while not peer.closed:
            try:
                remaining = settings.chat_idle_deadline_s - (
                    asyncio.get_running_loop().time() - last_frame_at
                )
                raw = await asyncio.wait_for(
                    ws.receive_text(), min(AUTH_RECHECK_S, max(0, remaining))
                )
            except TimeoutError:
                if await _db(_identify, token) != who:
                    await _close(ws, 4403)
                    return
                if (
                    asyncio.get_running_loop().time() - last_frame_at
                    >= settings.chat_idle_deadline_s
                ):
                    await _close(ws, CLOSE_IDLE)  # no ping in time: a dead or frozen client
                    return
                continue
            last_frame_at = asyncio.get_running_loop().time()
            if len(raw.encode("utf-8")) > MAX_FRAME_BYTES:
                await _close(ws, CLOSE_TOO_BIG)
                return
            if await _db(_identify, token) != who:
                await _close(ws, 4403)
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
                    {
                        "t": "error",
                        "code": "rate_limited",
                        "client_id": frame.get("client_id"),
                    },
                )
                continue
            if kind == "send":
                await _on_send(peer, conversation_id, me, frame)
            elif kind == "typing":
                await hub.publish(
                    conversation_id,
                    {
                        "t": "typing",
                        "from": me,
                        "on": bool(frame.get("on")),
                        "_skip": me,
                    },
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
                conversation_id,
                {"t": "presence", "user": me, "online": False, "_skip": me},
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
def messages(conversation_id: str, after: int = 0, who=Depends(_current_chat_identity)) -> dict:
    with SessionLocal() as db:
        convo = db.get(Conversation, conversation_id)
        if convo is None or convo.chat_backend != "own" or chat.side_of(convo, who[1]) != who[0]:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such conversation")
        return {
            "messages": chat.history(db, conversation_id, after),
            "last_seq": chat.last_seq(db, conversation_id),
        }


@router.post("/chat/{conversation_id}/wipe")
def wipe(conversation_id: str, who=Depends(_current_chat_identity)) -> dict:
    """Clean Wipe for an own-chat conversation — the same service as
    POST /conversations/{id}/wipe (services/conversations.clean_wipe): bodies deleted,
    the chat ended, the sockets told `wiped` then `ended` once it commits."""
    if who[0] != "member":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "members only")
    with SessionLocal() as db:
        convo = conversations.lock(db, conversation_id)
        if convo is None or convo.chat_backend != "own" or convo.user_id != who[1]:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "no such conversation")
        deleted = conversations.clean_wipe(db, convo, ConversationEndedBy.member)
        db.commit()
    return {"deleted": deleted}
