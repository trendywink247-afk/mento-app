"""Own-chat hardening (WS5 T5.3): a test for each limit, and a slow client that cannot
stall a room.

- per-person frame rate (`chat:{user}`, ratelimit.allow)
- 16 KB frames (uvicorn `--ws-max-size 16384` + the app's own check)
- a silent socket is closed at the idle deadline (clients ping ~every 30 s)
- a bounded send queue per socket; overflow drops that socket, never the room
- at most SOCKETS_PER_USER sockets per person per conversation
- Postgres `statement_timeout` on the app pool; pool 10 + 10
- the hello frame costs one database round; a message and its allowance count, one commit
"""

from __future__ import annotations

import asyncio
import re
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.exc import OperationalError
from starlette.websockets import WebSocketDisconnect

from app import chat_hub, ratelimit
from app.config import Settings, get_settings
from app.db import SessionLocal, engine_kwargs
from app.main import app
from app.models.chat_message import ChatMessage
from app.routers import chat as chat_router
from app.services import chat

from .chat_helpers import seed_chat
from .conftest import DB_URL, TestSession, requires_postgres, test_engine

pytestmark = requires_postgres

API_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def room(db_session):
    with TestSession() as s:
        return seed_chat(s)


def _open(client, room, who, after=0):
    cm = client.websocket_connect(f"/api/v1/chat/ws/{room.cid}")
    ws = cm.__enter__()
    ws.send_json({"t": "hello", "token": room[who], "after": after})
    assert ws.receive_json()["t"] == "hello"
    return cm, ws


def _next(ws, kind, tries=12):
    for _ in range(tries):
        frame = ws.receive_json()
        if frame["t"] == kind:
            return frame
    raise AssertionError(f"no {kind} frame")


def _stored(s) -> int:
    return s.execute(select(func.count()).select_from(ChatMessage)).scalar_one()


# ---- rate --------------------------------------------------------------------------------


def test_frames_over_the_per_person_budget_are_refused(client, room, monkeypatch):
    monkeypatch.setattr(ratelimit, "ENABLED", True)
    monkeypatch.setattr(get_settings(), "chat_frames_per_window", 3)
    cm, ws = _open(client, room, "member")
    for i in range(3):
        ws.send_json({"t": "send", "client_id": f"r{i}", "text": f"line {i}"})
        _next(ws, "message")
    ws.send_json({"t": "send", "client_id": "r3", "text": "one too many"})
    err = _next(ws, "error")
    assert (err["code"], err["client_id"]) == ("rate_limited", "r3")
    # Pings are free: a limited client can still keep its socket alive.
    ws.send_json({"t": "ping"})
    assert _next(ws, "pong")["t"] == "pong"
    cm.__exit__(None, None, None)
    with TestSession() as s:
        assert _stored(s) == 3


# ---- frame size --------------------------------------------------------------------------


def test_a_frame_over_16kb_closes_the_socket(client, room):
    cm, ws = _open(client, room, "member")
    ws.send_text('{"t":"send","client_id":"big","text":"' + "x" * (16 * 1024) + '"}')
    with pytest.raises(WebSocketDisconnect) as closed:
        ws.receive_json()
    assert closed.value.code == 1009
    cm.__exit__(None, None, None)
    with TestSession() as s:
        assert _stored(s) == 0


def test_the_server_is_launched_with_the_same_frame_cap():
    entry = (API_DIR / "docker-entrypoint.sh").read_text()
    assert re.search(r"--ws-max-size\s+16384\b", entry)
    assert chat_router.MAX_FRAME_BYTES == 16384


# ---- idle deadline ---------------------------------------------------------------------------


def test_a_socket_that_stops_pinging_is_closed(client, room, monkeypatch):
    monkeypatch.setattr(get_settings(), "chat_idle_deadline_s", 0.3)
    cm, ws = _open(client, room, "member")
    ws.send_json({"t": "ping"})
    assert _next(ws, "pong")["t"] == "pong"  # a ping resets the deadline
    started = time.monotonic()
    with pytest.raises(WebSocketDisconnect) as closed:
        ws.receive_json()
    assert closed.value.code == chat_router.CLOSE_IDLE
    assert time.monotonic() - started < 5
    cm.__exit__(None, None, None)


# ---- sockets per person ------------------------------------------------------------------------


def test_a_fourth_socket_retires_the_oldest(client, room):
    socks = [_open(client, room, "member") for _ in range(chat_hub.SOCKETS_PER_USER)]
    newest = _open(client, room, "member")
    oldest_cm, oldest = socks[0]
    with pytest.raises(WebSocketDisconnect) as closed:
        for _ in range(10):
            oldest.receive_json()
    assert closed.value.code == chat_hub.CLOSE_REPLACED
    # The newest socket works: a reconnect is never refused.
    newest[1].send_json({"t": "send", "client_id": "n1", "text": "still here"})
    assert _next(newest[1], "message")["message"]["text"] == "still here"
    for cm, _ in [*socks, newest]:
        cm.__exit__(None, None, None)


# ---- a slow client cannot stall a room ------------------------------------------------------------


class _FakeSocket:
    def __init__(self, stuck: bool) -> None:
        self.stuck = stuck
        self.frames: list[dict] = []
        self.closed_with: int | None = None
        self._never = asyncio.Event()

    async def send_json(self, frame: dict) -> None:
        if self.stuck:
            await self._never.wait()  # a client that stopped reading: TCP window full
        self.frames.append(frame)

    async def close(self, code: int = 1000) -> None:
        self.closed_with = code
        if self.stuck:
            await self._never.wait()  # even closing it would hang


def test_a_stuck_socket_is_dropped_and_the_room_keeps_moving():
    async def scenario() -> None:
        hub = chat_hub.Hub()  # no Valkey: local fan-out, the same queues
        slow, fast = _FakeSocket(stuck=True), _FakeSocket(stuck=False)
        for ws, who in ((slow, "a"), (fast, "b")):
            peer = hub.join("room", ws, who)  # type: ignore[arg-type]  # reason: fake socket
            await hub.arrive("room", peer, 0)

        total = chat_hub.SEND_QUEUE + 20
        started = time.monotonic()
        for seq in range(1, total + 1):
            await hub.publish("room", {"t": "message", "message": {"seq": seq}})
            await asyncio.sleep(0)
        for _ in range(100):
            if len(fast.frames) == total:
                break
            await asyncio.sleep(0.01)
        elapsed = time.monotonic() - started

        assert [f["message"]["seq"] for f in fast.frames] == list(range(1, total + 1))
        assert elapsed < 2.0  # the stuck socket never held the room
        assert slow.closed_with == chat_hub.CLOSE_TOO_SLOW
        assert hub.room_size("room") == 1

    asyncio.run(scenario())


def test_the_writer_skips_what_the_replay_already_sent():
    async def scenario() -> None:
        hub = chat_hub.Hub()
        ws = _FakeSocket(stuck=False)
        peer = hub.join("room", ws, "a")  # type: ignore[arg-type]  # reason: fake socket
        for seq in (4, 5, 6):  # published while the replay (up to 5) was being read
            await hub.publish("room", {"t": "message", "message": {"seq": seq}})
        await hub.arrive("room", peer, 5)
        for _ in range(50):
            if ws.frames:
                break
            await asyncio.sleep(0.01)
        await asyncio.sleep(0.05)
        assert [f["message"]["seq"] for f in ws.frames] == [6]

    asyncio.run(scenario())


# ---- database -----------------------------------------------------------------------------------


def test_the_app_pool_caps_every_statement():
    with SessionLocal() as db:
        assert db.execute(text("SHOW statement_timeout")).scalar_one() == "5s"
    defaults = Settings(_env_file=None)
    assert (defaults.db_pool_size, defaults.db_max_overflow) == (10, 10)


def test_a_statement_past_the_timeout_is_cancelled():
    short = Settings(_env_file=None, database_url=DB_URL, db_statement_timeout_ms=200)
    engine = create_engine(DB_URL, **engine_kwargs(short))
    try:
        with engine.connect() as conn, pytest.raises(OperationalError, match="statement timeout"):
            conn.execute(text("SELECT pg_sleep(2)"))
    finally:
        engine.dispose()


def test_hello_is_one_database_round(client, room, monkeypatch):
    calls: list[str] = []
    real = chat_router._db

    async def counting(fn, *a, **k):
        calls.append(fn.__name__)
        return await real(fn, *a, **k)

    monkeypatch.setattr(chat_router, "_db", counting)
    cm, _ = _open(client, room, "member")
    cm.__exit__(None, None, None)
    assert calls == ["opening"]


def test_a_message_and_its_allowance_count_commit_together(db_session, monkeypatch):
    """One commit for the message + count (then one for its jobs) — and a message that
    fails to land leaves no count behind."""
    room = seed_chat(db_session)
    monkeypatch.setattr(chat, "publish", lambda cid, ev: None)
    # Real COMMITs on the wire (a savepoint release is a different event).
    commits: list[int] = []
    listener = lambda conn: commits.append(1)  # noqa: E731
    event.listen(test_engine, "commit", listener)
    try:
        chat.send(db_session, room.member_id, room.cid, client_id="c1", body="hello")
    finally:
        event.remove(test_engine, "commit", listener)
    assert len(commits) == 2  # message + count, then the push job

    def fails(*a, **k):
        raise RuntimeError("insert failed")

    monkeypatch.setattr(chat, "persist_message", fails)
    with pytest.raises(RuntimeError):
        chat.send(db_session, room.member_id, room.cid, client_id="c2", body="again")
    db_session.rollback()
    sent = db_session.execute(text("SELECT sent FROM message_allowance_days")).scalar_one()
    assert sent == 1
