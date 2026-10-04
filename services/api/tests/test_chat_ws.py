"""Own chat over the WebSocket (WS5 T5.1): the spike's ten tests, on master.

The message path Stream used to provide, on our server.

Proves, against real Postgres and the real WebSocket endpoint, the guarantees the Stream
setup gave us: crisis scan on every message, allowance after the scan, redaction, exactly-
once send, lossless reconnect, typing / read / presence, and a Clean Wipe that deletes.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import get_settings
from app.main import app
from app.models.chat_message import ChatMessage
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus
from app.models.safety import SafetyFlag
from app.security import issue_admin_token, issue_session_token

from .chat_helpers import seed_chat
from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture
def client():
    """Entered, so every socket shares ONE event loop (each un-entered websocket_connect
    gets its own portal, and the hub would await a socket owned by another loop) and the
    lifespan runs — the hub fans out over Valkey pub/sub, as in production."""
    with TestClient(app) as c:
        yield c


@pytest.fixture
def chat(db_session):
    """A member, a mentor and an active conversation between them."""
    with TestSession() as s:
        return seed_chat(s)


def _open(client, chat, who, after=0):
    ws = client.websocket_connect(f"/api/v1/chat/ws/{chat['cid']}")
    conn = ws.__enter__()
    conn.send_json({"t": "hello", "token": chat[who], "after": after})
    hello = conn.receive_json()
    assert hello["t"] == "hello"
    return ws, conn, hello


def _next(conn, kind):
    """Next frame of a kind (presence frames may interleave)."""
    for _ in range(10):
        f = conn.receive_json()
        if f["t"] == kind:
            return f
    raise AssertionError(f"no {kind} frame")


def test_two_parties_exchange_messages_in_order(client, chat):
    mws, member, hello = _open(client, chat, "member")
    assert hello["side"] == "member" and hello["last_seq"] == 0
    lws, mentor, hello = _open(client, chat, "mentor")
    assert hello["side"] == "mentor" and hello["peer_online"] is True

    member.send_json({"t": "send", "client_id": "a1", "text": "hello there"})
    at_member = _next(member, "message")["message"]
    at_mentor = _next(mentor, "message")["message"]
    assert at_member["id"] == at_mentor["id"]
    assert (at_member["seq"], at_member["client_id"], at_member["text"]) == (1, "a1", "hello there")

    mentor.send_json({"t": "send", "client_id": "b1", "text": "i am here"})
    assert _next(member, "message")["message"]["seq"] == 2
    assert _next(mentor, "message")["message"]["sender"] == chat["mentor_id"]
    mws.__exit__(None, None, None)
    lws.__exit__(None, None, None)


def test_typing_and_read_state_reach_the_other_side_only(client, chat):
    mws, member, _ = _open(client, chat, "member")
    lws, mentor, _ = _open(client, chat, "mentor")
    member.send_json({"t": "send", "client_id": "a1", "text": "hi"})
    _next(member, "message")
    seq = _next(mentor, "message")["message"]["seq"]

    mentor.send_json({"t": "typing", "on": True})
    typing = _next(member, "typing")
    assert typing["from"] == chat["mentor_id"] and typing["on"] is True

    mentor.send_json({"t": "read", "seq": seq})
    assert _next(member, "read")["seq"] == seq
    mws.__exit__(None, None, None)
    lws.__exit__(None, None, None)


def test_a_retried_send_is_stored_once(client, chat):
    mws, member, _ = _open(client, chat, "member")
    for _ in range(3):
        member.send_json({"t": "send", "client_id": "same", "text": "only once"})
        assert _next(member, "message")["message"]["text"] == "only once"
    mws.__exit__(None, None, None)
    with TestSession() as s:
        assert s.execute(select(func.count()).select_from(ChatMessage)).scalar_one() == 1


def test_crisis_message_is_flagged_and_carries_the_helpline_card(client, chat):
    mws, member, _ = _open(client, chat, "member")
    lws, mentor, _ = _open(client, chat, "mentor")
    member.send_json({"t": "send", "client_id": "c1", "text": "i want to end my life"})
    for conn in (member, mentor):
        m = _next(conn, "message")["message"]
        assert m["crisis"]["signal"] == "suicidal"
        assert m["crisis"]["helplines"]  # the same object shape the CrisisCard already renders
    mws.__exit__(None, None, None)
    lws.__exit__(None, None, None)
    with TestSession() as s:
        flag = s.execute(select(SafetyFlag)).scalar_one()
        assert flag.user_id == chat["member_id"] and flag.matched_terms == "suicidal"
        assert "end my life" not in (flag.matched_terms or "")  # signal only, never the body


def test_allowance_holds_the_fourth_message_but_never_a_crisis_one(client, chat, monkeypatch):
    monkeypatch.setattr(get_settings(), "allowance_enforced", True)
    mws, member, _ = _open(client, chat, "member")
    for i in range(3):
        member.send_json({"t": "send", "client_id": f"m{i}", "text": f"line {i}"})
        _next(member, "message")
    member.send_json({"t": "send", "client_id": "m3", "text": "line 3"})
    held = _next(member, "held")
    assert held["allowance"]["held"] is True and held["client_id"] == "m3"

    member.send_json({"t": "send", "client_id": "m4", "text": "i want to kill myself"})
    assert _next(member, "message")["message"]["crisis"]["signal"] == "suicidal"
    mws.__exit__(None, None, None)
    with TestSession() as s:  # the held one was never stored
        assert s.execute(select(func.count()).select_from(ChatMessage)).scalar_one() == 4


def test_pii_is_redacted_before_the_recipient_sees_it(client, chat):
    mws, member, _ = _open(client, chat, "member")
    lws, mentor, _ = _open(client, chat, "mentor")
    member.send_json({"t": "send", "client_id": "p1", "text": "call me on 9876543210"})
    got = _next(mentor, "message")["message"]
    assert "9876543210" not in got["text"] and got["moderation"]["redacted"] is True
    mws.__exit__(None, None, None)
    lws.__exit__(None, None, None)


def test_reconnect_replays_exactly_what_was_missed(client, chat):
    mws, member, _ = _open(client, chat, "member")
    lws, mentor, _ = _open(client, chat, "mentor")
    for i in range(3):
        member.send_json({"t": "send", "client_id": f"a{i}", "text": f"m{i}"})
        _next(mentor, "message")
    lws.__exit__(None, None, None)  # the mentor's connection drops after seq 3

    for i in range(2):
        member.send_json({"t": "send", "client_id": f"b{i}", "text": f"while away {i}"})
    while _next(member, "message")["message"]["text"] != "while away 1":
        pass  # the member's own echoes arrive in order; this one is the last

    lws, mentor, hello = _open(client, chat, "mentor", after=3)
    assert hello["last_seq"] == 5
    replay = [_next(mentor, "message")["message"] for _ in range(2)]
    assert [m["seq"] for m in replay] == [4, 5]
    mws.__exit__(None, None, None)
    lws.__exit__(None, None, None)


def test_only_the_two_participants_can_join(client, chat):
    stranger = issue_session_token("00000000-0000-0000-0000-000000000000")
    for token in (stranger, issue_admin_token("x"), "garbage"):
        with client.websocket_connect(f"/api/v1/chat/ws/{chat['cid']}") as ws:
            ws.send_json({"t": "hello", "token": token})
            with pytest.raises(Exception):  # noqa: B017 — server closes with 4403
                ws.receive_json()


def test_history_endpoint_and_clean_wipe_really_delete(client, chat):
    mws, member, _ = _open(client, chat, "member")
    member.send_json({"t": "send", "client_id": "h1", "text": "keep this private"})
    _next(member, "message")
    mws.__exit__(None, None, None)

    auth = {"Authorization": f"Bearer {chat['member']}"}
    r = client.get(f"/api/v1/chat/{chat['cid']}/messages", headers=auth)
    assert [m["text"] for m in r.json()["messages"]] == ["keep this private"]

    # a mentor cannot wipe; the member can
    assert (
        client.post(
            f"/api/v1/chat/{chat['cid']}/wipe",
            headers={"Authorization": f"Bearer {chat['mentor']}"},
        ).status_code
        == 403
    )
    assert client.post(f"/api/v1/chat/{chat['cid']}/wipe", headers=auth).json()["deleted"] == 1
    with TestSession() as s:
        assert s.execute(select(func.count()).select_from(ChatMessage)).scalar_one() == 0


def test_an_ended_conversation_takes_no_more_messages(client, chat):
    with TestSession() as s:
        s.get(Conversation, chat["cid"]).status = ConversationStatus.ended
        s.commit()
    with client.websocket_connect(f"/api/v1/chat/ws/{chat['cid']}") as ws:
        ws.send_json({"t": "hello", "token": chat["member"]})
        with pytest.raises(Exception):  # noqa: B017 — closed 4403
            ws.receive_json()


def test_a_suspended_member_socket_is_revoked_and_nothing_is_stored(client, chat):
    """Socket standing is checked before frames; suspension revokes the transport."""
    from starlette.websockets import WebSocketDisconnect

    from app.models.enums import MemberStatus
    from app.models.user import User

    with client.websocket_connect(f"/api/v1/chat/ws/{chat['cid']}") as member:
        member.send_json({"t": "hello", "token": chat["member"]})
        assert member.receive_json()["t"] == "hello"
        with TestSession() as s:
            s.get(User, chat["member_id"]).status = MemberStatus.suspended
            s.commit()
        member.send_json({"t": "send", "client_id": "z1", "text": "hello?"})
        with pytest.raises(WebSocketDisconnect) as closed:
            member.receive_json()
        assert closed.value.code == 4403
    with TestSession() as s:
        assert s.execute(select(func.count()).select_from(ChatMessage)).scalar_one() == 0
