"""Own chat across API workers (WS5 T5.1 accept): a message sent to one uvicorn process
reaches a socket held by ANOTHER, over Valkey pub/sub.

Two real `uvicorn` processes on two ports, the member connected to one and the mentor to
the other. Separate processes share no memory, so a delivery here can only have come
through Valkey — which is exactly the multi-worker deployment (blue/green, or
`--workers N`) the hub has to survive. `--workers 2` on one port is not used because
the kernel, not the test, decides which worker a socket lands on.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from contextlib import closing
from pathlib import Path

import pytest
import redis
from websockets.sync.client import connect

from app.config import get_settings

from .chat_helpers import seed_chat
from .conftest import DB_URL, TestSession, requires_postgres

API_DIR = Path(__file__).resolve().parents[1]

pytestmark = requires_postgres


def _valkey_up() -> bool:
    try:
        return bool(redis.Redis.from_url(get_settings().redis_url).ping())
    except redis.RedisError:
        return False


def _free_port() -> int:
    with closing(socket.socket()) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_ready(port: int, proc: subprocess.Popen, timeout: float = 30.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"uvicorn on :{port} exited with {proc.returncode}")
        try:
            with closing(socket.create_connection(("127.0.0.1", port), timeout=0.5)):
                return
        except OSError:
            time.sleep(0.2)
    raise TimeoutError(f"uvicorn on :{port} never listened")


@pytest.fixture
def two_workers():
    if not _valkey_up():
        pytest.fail("Valkey/Redis is not reachable — this proof needs it (a skip is not a pass)")
    env = {**os.environ, "DATABASE_URL": DB_URL, "ENV": "dev"}
    procs: list[tuple[int, subprocess.Popen]] = []
    try:
        for _ in range(2):
            port = _free_port()
            proc = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--port",
                    str(port),
                    "--ws-max-size",
                    "16384",
                ],
                cwd=API_DIR,
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            procs.append((port, proc))
        for port, proc in procs:
            _wait_ready(port, proc)
        yield [port for port, _ in procs]
    finally:
        for _, proc in procs:
            proc.terminate()
        for _, proc in procs:
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


def _frames_until(ws, kind: str, timeout: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout
    while True:
        frame = json.loads(ws.recv(timeout=max(0.1, deadline - time.monotonic())))
        if frame["t"] == kind:
            return frame


def _hello(port: int, cid: str, token: str):
    ws = connect(f"ws://127.0.0.1:{port}/api/v1/chat/ws/{cid}")
    ws.send(json.dumps({"t": "hello", "token": token}))
    assert _frames_until(ws, "hello")["t"] == "hello"
    return ws


def test_a_message_crosses_from_one_worker_to_another(db_session, two_workers):
    with TestSession() as s:
        chat = seed_chat(s)
    port_a, port_b = two_workers

    member = _hello(port_a, chat.cid, chat.member)
    mentor = _hello(port_b, chat.cid, chat.mentor)
    try:
        # Presence crossed too: the member's worker learns the mentor came online.
        assert _frames_until(member, "presence")["online"] is True

        member.send(json.dumps({"t": "send", "client_id": "x1", "text": "across workers"}))
        got = _frames_until(mentor, "message")["message"]
        assert (got["text"], got["seq"]) == ("across workers", 1)

        mentor.send(json.dumps({"t": "send", "client_id": "y1", "text": "and back"}))
        # The member first sees its own echo (seq 1), then the mentor's reply.
        seen = [_frames_until(member, "message")["message"]["seq"] for _ in range(2)]
        assert seen == [1, 2]

        mentor.send(json.dumps({"t": "typing", "on": True}))
        assert _frames_until(member, "typing")["from"] == chat.mentor_id
    finally:
        member.close()
        mentor.close()


def test_presence_goes_offline_across_workers_when_a_socket_closes(db_session, two_workers):
    """T5.4 on a real server: the mentor's socket closes on one worker and the member,
    on the other, hears "offline". (The starlette TestClient cancels the app task on
    exit instead of delivering a disconnect, so this half is proven here.)"""
    with TestSession() as s:
        chat = seed_chat(s)
    port_a, port_b = two_workers
    member = _hello(port_a, chat.cid, chat.member)
    mentor = _hello(port_b, chat.cid, chat.mentor)
    try:
        came = _frames_until(member, "presence")
        assert (came["user"], came["online"]) == (chat.mentor_id, True)
        mentor.close()
        went = _frames_until(member, "presence")
        assert (went["user"], went["online"]) == (chat.mentor_id, False)
    finally:
        member.close()
