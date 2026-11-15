"""Live events socket (docs/LIVE_EVENTS.md): one per foreground app, the server pushes, nobody polls.

  WS  /events   first frame within 5 s: {"t":"auth","token":"<bearer>","role":"member"|"listener"}
                server -> client: hello · request.new · request.gone · request.changed ·
                                  conversation.changed · review.decided
                client -> server: bye (anything else is ignored)

The token is checked exactly like the REST bearer for that role (signature, expiry, standing)
and travels in a frame, never the URL, so it stays out of logs. Close codes: 4401 bad, missing
or late auth (or the token expired), 4403 standing lost, 4409 replaced by a newer socket of
the same identity (at most 3), 1009 frame over 1 KB, 1013 too slow, 4429 connecting too fast.
Keepalive is the WebSocket protocol ping (uvicorn, docker-entrypoint.sh): no app frames.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging

import anyio.to_thread
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import SessionLocal
from app.errors import ApiProblem
from app.events_hub import CLOSE_UNAUTHORIZED, hub
from app.security import _decode, current_user_id

logger = logging.getLogger("mento.events.router")
router = APIRouter(tags=["events"])

AUTH_TIMEOUT_S = 5.0
MAX_FRAME_BYTES = 1024
CLOSE_TOO_BIG = 1009
CLOSE_TOO_FAST = 4429
CONNECTS_PER_WINDOW = 30  # per identity, per 5 minutes: a reconnect loop, not a person
CONNECT_WINDOW_S = 300


def _authorize(token: object, role: object) -> tuple[tuple[str, str], float] | None:
    """(identity, token expiry) — the same checks the REST routes make — or None."""
    if not isinstance(token, str) or not token or role not in ("member", "listener"):
        return None
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    try:
        payload = _decode(creds, "listener" if role == "listener" else "user")
    except (HTTPException, ApiProblem):
        return None
    with SessionLocal() as db:
        try:
            who = _identity(db, creds, role)
        except (HTTPException, ApiProblem):
            return None
        if who is None:
            return None
        if role == "listener":
            _touch(db, who[1])
    return who, float(payload.get("exp") or 0)


def _identity(
    db: Session, creds: HTTPAuthorizationCredentials, role: str
) -> tuple[str, str] | None:
    from app.models.enums import VettingStatus
    from app.models.listener import ListenerProfile
    from app.models.user import User
    from app.security import current_listener_id, current_member_or_listener

    if role == "listener":
        listener_id = current_listener_id(creds)
        mentor = db.get(ListenerProfile, listener_id)
        if mentor is None or mentor.vetting_status != VettingStatus.approved:
            return None
        return "listener", listener_id
    kind, subject = current_member_or_listener(creds)
    if kind != "member":
        return None
    current_user_id(creds, db)  # 403 while suspended or banned
    if db.get(User, subject) is None:
        return None
    return "member", subject


def _touch(db: Session, listener_id: str) -> None:
    """Opening the app counts as the heartbeat the console used to send (no behaviour change:
    the stale-presence sweep reads the same column)."""
    from datetime import UTC, datetime

    from sqlalchemy import update

    from app.models.listener import ListenerProfile

    db.execute(
        update(ListenerProfile)
        .where(ListenerProfile.id == listener_id)
        .values(last_seen_at=datetime.now(UTC))
    )
    db.commit()


@router.websocket("/events")
async def events_ws(ws: WebSocket) -> None:
    await ws.accept()
    try:
        raw = await asyncio.wait_for(ws.receive_text(), AUTH_TIMEOUT_S)
        first = json.loads(raw) if len(raw.encode("utf-8")) <= MAX_FRAME_BYTES else None
    except (TimeoutError, WebSocketDisconnect, ValueError, KeyError):
        await _close(ws, CLOSE_UNAUTHORIZED)
        return
    first = first if isinstance(first, dict) else {}
    authorized = None
    if first.get("t") == "auth":
        authorized = await anyio.to_thread.run_sync(
            _authorize, first.get("token"), first.get("role")
        )
    if authorized is None:
        await _close(ws, CLOSE_UNAUTHORIZED)
        return
    who, expires_at = authorized
    if not await anyio.to_thread.run_sync(
        ratelimit.allow, f"events-connect:{who[0]}:{who[1]}", CONNECTS_PER_WINDOW, CONNECT_WINDOW_S
    ):
        await _close(ws, CLOSE_TOO_FAST)
        return

    conn = await hub.register(ws, who, expires_at)
    try:
        conn.queue.put_nowait({"t": "hello"})
        while not conn.closed:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                return
            data = msg.get("text")
            if data is None:
                data = (msg.get("bytes") or b"").decode("utf-8", "replace")
            if len(data.encode("utf-8")) > MAX_FRAME_BYTES:
                await _close(ws, CLOSE_TOO_BIG)
                return
            with contextlib.suppress(ValueError):
                frame = json.loads(data)
                if isinstance(frame, dict) and frame.get("t") == "bye":
                    await _close(ws, 1000)
                    return
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 — one bad socket never takes the process down
        logger.exception("events socket error")
    finally:
        await hub.unregister(conn)


async def _close(ws: WebSocket, code: int) -> None:
    with contextlib.suppress(Exception):
        await ws.close(code=code)
