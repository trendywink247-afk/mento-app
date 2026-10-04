"""Existing safety/options endpoints select the persisted message provider."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models.chat_message import ChatMessage
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus
from app.services import chat, stream

from .chat_helpers import seed_chat
from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


def forbid_stream(*args, **kwargs):
    pytest.fail("Own-owned conversation reached the Stream provider")


@pytest.mark.parametrize("action", ["wipe", "report", "block"])
def test_member_safety_options_do_not_contact_stream_for_own_room(db_session, monkeypatch, action):
    room = seed_chat(db_session)
    chat.send(db_session, room.mentor_id, room.cid, client_id="before-action", body="hello")
    monkeypatch.setattr(stream, "erase_channel", forbid_stream)
    monkeypatch.setattr(stream, "freeze_channel", forbid_stream)
    with TestClient(app) as client:
        response = client.post(
            f"/api/v1/conversations/{room.cid}/{action}",
            json={"reason": "other"},
            headers={"Authorization": f"Bearer {room.member}"},
        )
    assert response.status_code == 200, response.text
    with TestSession() as db:
        conversation = db.get(Conversation, room.cid)
        assert conversation.status == (
            ConversationStatus.wiped if action == "wipe" else ConversationStatus.ended
        )
        assert conversation.chat_backend == "own"
        remaining = db.scalar(
            select(func.count())
            .select_from(ChatMessage)
            .where(ChatMessage.conversation_id == room.cid)
        )
        assert remaining == (0 if action == "wipe" else 1)


def test_mentor_context_uses_own_timestamp_without_stream(db_session, monkeypatch):
    room = seed_chat(db_session)
    chat.send(db_session, room.member_id, room.cid, client_id="member-context", body="hello")
    expected = db_session.scalar(
        select(func.max(ChatMessage.created_at)).where(ChatMessage.conversation_id == room.cid)
    )
    monkeypatch.setattr(stream, "channel_last_message_at", forbid_stream)
    with TestClient(app) as client:
        response = client.get(
            f"/api/v1/listener/me/conversations/{room.cid}/brief",
            headers={"Authorization": f"Bearer {room.mentor}"},
        )
    assert response.status_code == 200, response.text
    assert response.json()["last_message_at"] == expected.isoformat()
