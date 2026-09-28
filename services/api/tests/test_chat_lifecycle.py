"""Own-chat lifecycle (WS5 T5.4): presence, typing, read state, ended and wiped events,
and a reconnect that replays exactly the missed messages after its seq — no more, no
less, even when a message lands while the socket is still saying hello.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from starlette.websockets import WebSocketDisconnect

from app import chat_hub
from app.main import app
from app.models.chat_message import ChatMessage, ChatReadMarker
from app.models.conversation import Conversation
from app.models.enums import ConversationEndedBy, ConversationStatus
from app.routers import chat as chat_router
from app.services import chat, conversations

from .chat_helpers import seed_chat
from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def room(db_session):
    with TestSession() as s:
        return seed_chat(s)


_OPENED: list = []


@pytest.fixture(autouse=True)
def _close_what_a_test_left_open(client):
    """Torn down BEFORE the client: a failed assertion must fail the test, not leave a
    socket open that the TestClient's exit then waits on forever."""
    yield
    while _OPENED:
        cm = _OPENED.pop()
        try:
            cm.__exit__(None, None, None)
        except Exception:  # noqa: BLE001, S110 — already closed by the test or the server
            pass


def _open(client, room, who, after=0):
    cm = client.websocket_connect(f"/api/v1/chat/ws/{room.cid}")
    _OPENED.append(cm)
    ws = cm.__enter__()
    ws.send_json({"t": "hello", "token": room[who], "after": after})
    hello = ws.receive_json()
    assert hello["t"] == "hello"
    return cm, ws, hello


def _next(ws, kind, tries=15):
    for _ in range(tries):
        frame = ws.receive_json()
        if frame["t"] == kind:
            return frame
    raise AssertionError(f"no {kind} frame")


def _messages_until_quiet(ws, stop_seq):
    """Every message frame up to and including `stop_seq`, in arrival order."""
    seqs: list[int] = []
    while True:
        frame = ws.receive_json()
        if frame["t"] == "message":
            seqs.append(frame["message"]["seq"])
            if frame["message"]["seq"] >= stop_seq:
                return seqs


def _send(ws, cid, text):
    ws.send_json({"t": "send", "client_id": cid, "text": text})


# ---- reconnect: exactly what was missed --------------------------------------------------------


def test_reconnect_gets_exactly_the_messages_after_its_seq(client, room):
    mcm, member, _ = _open(client, room, "member")
    for i in range(5):
        _send(member, f"a{i}", f"m{i}")
        _next(member, "message")

    lcm, mentor, hello = _open(client, room, "mentor", after=2)
    assert hello["last_seq"] == 5
    _send(member, "a5", "after the mentor came back")
    assert _messages_until_quiet(mentor, 6) == [3, 4, 5, 6]
    mcm.__exit__(None, None, None)
    lcm.__exit__(None, None, None)


def test_a_message_landing_during_hello_arrives_once(client, room, monkeypatch):
    """The race T5.4 is about: a message is stored and published after the socket
    joined the room but before its history snapshot was read. It is in BOTH the
    snapshot and the live queue; the socket must see it exactly once."""
    mcm, member, _ = _open(client, room, "member")
    _send(member, "a0", "before")
    _next(member, "message")

    real_opening = chat.opening

    def racing_opening(db, conversation_id, actor_id, after_seq):
        if actor_id == room.mentor_id:
            chat.send(db, room.member_id, conversation_id, client_id="race", body="during hello")
        return real_opening(db, conversation_id, actor_id, after_seq)

    monkeypatch.setattr(chat, "opening", racing_opening)
    lcm, mentor, hello = _open(client, room, "mentor", after=0)
    assert hello["last_seq"] == 2
    _send(member, "a2", "after")
    assert _messages_until_quiet(mentor, 3) == [1, 2, 3]
    mcm.__exit__(None, None, None)
    lcm.__exit__(None, None, None)


def test_a_reconnect_that_missed_nothing_replays_nothing(client, room):
    mcm, member, _ = _open(client, room, "member")
    _send(member, "a0", "only one")
    _next(member, "message")
    lcm, mentor, hello = _open(client, room, "mentor", after=1)
    _send(member, "a1", "next")
    assert _messages_until_quiet(mentor, 2) == [2]
    mcm.__exit__(None, None, None)
    lcm.__exit__(None, None, None)


# ---- presence, typing, read -----------------------------------------------------------------------


def test_presence_follows_the_other_side_in(client, room):
    """Coming online. Going offline is proven on real uvicorn workers
    (test_chat_workers.py): the TestClient cancels the app task on exit instead of
    delivering a disconnect, so the handler's offline publish never runs here."""
    mcm, member, hello = _open(client, room, "member")
    assert hello["peer_online"] is False
    lcm, mentor, hello = _open(client, room, "mentor")
    assert hello["peer_online"] is True
    came = _next(member, "presence")
    assert (came["user"], came["online"]) == (room.mentor_id, True)
    lcm.__exit__(None, None, None)
    mcm.__exit__(None, None, None)


def test_typing_on_and_off_reach_only_the_other_side(client, room):
    mcm, member, _ = _open(client, room, "member")
    lcm, mentor, _ = _open(client, room, "mentor")
    _next(member, "presence")
    mentor.send_json({"t": "typing", "on": True})
    mentor.send_json({"t": "typing", "on": False})
    assert [_next(member, "typing")["on"] for _ in range(2)] == [True, False]
    # The typist never hears itself: no `typing` frame reaches mentor before the pong.
    # A `presence` frame CAN land in between — member's own connect-presence publish
    # round-trips through Valkey pub/sub (chat_hub.py) with no ordering guarantee
    # relative to a ping on a different socket (session 48) — that's not the invariant
    # this test is proving, so it's not asserted away.
    mentor.send_json({"t": "ping"})
    for _ in range(15):
        frame = mentor.receive_json()
        assert frame["t"] != "typing"
        if frame["t"] == "pong":
            break
    else:
        raise AssertionError("no pong")
    mcm.__exit__(None, None, None)
    lcm.__exit__(None, None, None)


def test_read_markers_only_move_forward_and_come_back_in_hello(client, room):
    mcm, member, _ = _open(client, room, "member")
    for i in range(3):
        _send(member, f"a{i}", f"m{i}")
        _next(member, "message")
    lcm, mentor, _ = _open(client, room, "mentor")
    mentor.send_json({"t": "read", "seq": 3})
    assert _next(member, "read") == {"t": "read", "by": room.mentor_id, "seq": 3}
    mentor.send_json({"t": "read", "seq": 1})  # never backwards
    assert _next(member, "read")["seq"] == 3
    mentor.send_json({"t": "read", "seq": 99})  # never past the last message
    assert _next(member, "read")["seq"] == 3
    lcm.__exit__(None, None, None)
    again, _, hello = _open(client, room, "mentor")
    assert hello["read"] == {room.mentor_id: 3}
    again.__exit__(None, None, None)
    mcm.__exit__(None, None, None)


# ---- ended and wiped ------------------------------------------------------------------------------


def _closed_with(ws) -> int:
    with pytest.raises(WebSocketDisconnect) as closed:
        for _ in range(10):
            ws.receive_json()
    return closed.value.code


def test_ending_the_chat_tells_both_sides_and_closes_their_sockets(client, room):
    mcm, member, _ = _open(client, room, "member")
    lcm, mentor, _ = _open(client, room, "mentor")
    r = client.post(
        f"/api/v1/conversations/{room.cid}/end",
        headers={"Authorization": f"Bearer {room.member}"},
    )
    assert r.status_code == 200
    for ws in (member, mentor):
        assert _next(ws, "ended") == {"t": "ended", "by": "member"}
        assert _closed_with(ws) == chat_hub.CLOSE_ENDED
    mcm.__exit__(None, None, None)
    lcm.__exit__(None, None, None)

    # And the door stays shut: a new socket is refused.
    with client.websocket_connect(f"/api/v1/chat/ws/{room.cid}") as ws:
        ws.send_json({"t": "hello", "token": room.member})
        with pytest.raises(WebSocketDisconnect) as refused:
            ws.receive_json()
        assert refused.value.code == 4403


def test_a_mentor_end_from_the_console_reaches_the_member(client, room):
    mcm, member, _ = _open(client, room, "member")
    with TestSession() as s:
        convo = conversations.lock(s, room.cid)
        conversations.end(s, convo, ConversationEndedBy.listener)
        s.commit()  # a job/script path: publishes straight to Valkey
    assert _next(member, "ended")["by"] == "listener"
    assert _closed_with(member) == chat_hub.CLOSE_ENDED
    mcm.__exit__(None, None, None)


def test_an_end_that_rolls_back_says_nothing(client, room):
    mcm, member, _ = _open(client, room, "member")
    with TestSession() as s:
        convo = conversations.lock(s, room.cid)
        conversations.end(s, convo, ConversationEndedBy.member)
        s.rollback()
    member.send_json({"t": "ping"})
    assert member.receive_json()["t"] == "pong"  # nothing queued ahead of it
    with TestSession() as s:
        assert s.get(Conversation, room.cid).status == ConversationStatus.active
    mcm.__exit__(None, None, None)


def test_clean_wipe_deletes_the_bodies_and_tells_both_sides(client, room):
    mcm, member, _ = _open(client, room, "member")
    lcm, mentor, _ = _open(client, room, "mentor")
    _send(member, "a0", "keep this private")
    _next(mentor, "message")
    mentor.send_json({"t": "read", "seq": 1})
    _next(member, "read")

    r = client.post(
        f"/api/v1/conversations/{room.cid}/wipe",
        headers={"Authorization": f"Bearer {room.member}"},
    )
    assert r.status_code == 200
    for ws in (member, mentor):
        assert _next(ws, "wiped") == {"t": "wiped"}
        assert _next(ws, "ended")["t"] == "ended"
        assert _closed_with(ws) == chat_hub.CLOSE_ENDED
    mcm.__exit__(None, None, None)
    lcm.__exit__(None, None, None)
    with TestSession() as s:
        assert s.execute(select(func.count()).select_from(ChatMessage)).scalar_one() == 0
        assert s.execute(select(func.count()).select_from(ChatReadMarker)).scalar_one() == 0
        assert s.get(Conversation, room.cid).status == ConversationStatus.wiped


def test_the_close_codes_are_distinct():
    codes = {
        chat_hub.CLOSE_ENDED,
        chat_hub.CLOSE_REPLACED,
        chat_hub.CLOSE_TOO_SLOW,
        chat_router.CLOSE_IDLE,
        chat_router.CLOSE_TOO_BIG,
    }
    assert len(codes) == 5
