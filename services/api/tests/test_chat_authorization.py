"""Own-chat history and sockets honor live identity controls, not just a signature."""

from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.models.chat_message import ChatMessage
from app.models.enums import MemberStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.routers import chat as chat_router
from app.security import _mint, issue_listener_token, issue_session_token

from .chat_helpers import seed_chat
from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture
def room(db_session):
    with TestSession() as db:
        return seed_chat(db)


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


def revoke(room, role):
    with TestSession() as db:
        if role == "member":
            db.get(User, room.member_id).status = MemberStatus.suspended
        else:
            db.get(ListenerProfile, room.mentor_id).vetting_status = VettingStatus.suspended
        db.commit()


@pytest.mark.parametrize("role", ["member", "mentor"])
def test_revoked_identity_cannot_read_history_or_reconnect(client, room, role):
    revoke(room, role)
    response = client.get(
        f"/api/v1/chat/{room.cid}/messages", headers={"Authorization": f"Bearer {room[role]}"}
    )
    assert response.status_code == 403
    with client.websocket_connect(f"/api/v1/chat/ws/{room.cid}") as ws:
        ws.send_json({"t": "hello", "token": room[role]})
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4403


@pytest.mark.parametrize("role", ["member", "mentor"])
@pytest.mark.parametrize(
    "frame",
    [
        {"t": "send", "client_id": "refused", "text": "private"},
        {"t": "typing", "on": True},
        {"t": "read", "seq": 1},
        {"t": "ping"},
    ],
)
def test_existing_socket_refuses_frames_after_identity_revocation(client, room, role, frame):
    with client.websocket_connect(f"/api/v1/chat/ws/{room.cid}") as ws:
        ws.send_json({"t": "hello", "token": room[role]})
        assert ws.receive_json()["t"] == "hello"
        revoke(room, role)
        ws.send_json(frame)
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4403
    with TestSession() as db:
        assert db.scalar(select(func.count()).select_from(ChatMessage)) == 0


@pytest.mark.parametrize("role", ["member", "mentor"])
def test_passive_socket_is_closed_after_revocation(client, room, role, monkeypatch):
    monkeypatch.setattr(chat_router, "AUTH_RECHECK_S", 0.05)
    with client.websocket_connect(f"/api/v1/chat/ws/{room.cid}") as ws:
        ws.send_json({"t": "hello", "token": room[role]})
        assert ws.receive_json()["t"] == "hello"
        revoke(room, role)
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4403


@pytest.mark.parametrize("token_role", ["user", "listener"])
def test_expired_identity_cannot_reconnect(client, room, token_role):
    subject = room.member_id if token_role == "user" else room.mentor_id
    token = _mint(subject, token_role, timedelta(seconds=-1))
    with client.websocket_connect(f"/api/v1/chat/ws/{room.cid}") as ws:
        ws.send_json({"t": "hello", "token": token})
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4403


@pytest.mark.parametrize("role", ["member", "mentor"])
def test_passive_socket_closes_when_its_token_expires(client, room, role, monkeypatch):
    monkeypatch.setattr(chat_router, "AUTH_RECHECK_S", 0.05)
    claims = jwt.decode(room[role], options={"verify_signature": False})

    class ExpiredClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromtimestamp(claims["exp"] + 1, UTC)

    with client.websocket_connect(f"/api/v1/chat/ws/{room.cid}") as ws:
        ws.send_json({"t": "hello", "token": room[role]})
        assert ws.receive_json()["t"] == "hello"
        monkeypatch.setattr(jwt.api_jwt, "datetime", ExpiredClock)
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4403


def test_wrong_role_with_participant_subject_cannot_read_or_join(client, room):
    # A mentor-role signature cannot grant the member's side of a conversation.
    token = issue_listener_token(room.member_id)
    assert (
        client.get(
            f"/api/v1/chat/{room.cid}/messages", headers={"Authorization": f"Bearer {token}"}
        ).status_code
        == 403
    )
    # Likewise a member-role token cannot grant the mentor's side.
    token = issue_session_token(room.mentor_id)
    with client.websocket_connect(f"/api/v1/chat/ws/{room.cid}") as ws:
        ws.send_json({"t": "hello", "token": token})
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4403
