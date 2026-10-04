"""Server-owned room transport and preservation during schema rollback."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.models.chat_message import ChatMessage
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus
from app.services import chat

from .chat_helpers import seed_chat
from .conftest import TestSession, requires_postgres, test_engine

pytestmark = requires_postgres


@pytest.fixture
def stream_room(db_session):
    room = seed_chat(db_session)
    conversation = db_session.get(Conversation, room.cid)
    conversation.chat_backend = "stream"
    db_session.commit()
    # Deliberately retain channel_id == conversation_id. Ownership cannot be
    # inferred from the shape of a Stream channel key.
    return room


@pytest.fixture
def client():
    with TestClient(app) as value:
        yield value


@pytest.mark.parametrize("role", ["member", "mentor"])
def test_stream_participant_cannot_open_own_socket(client, stream_room, role):
    with client.websocket_connect(f"/api/v1/chat/ws/{stream_room.cid}") as ws:
        # A client-supplied transport hint must never override database ownership.
        ws.send_json({"t": "hello", "token": getattr(stream_room, role), "chat_backend": "own"})
        with pytest.raises(WebSocketDisconnect) as closed:
            ws.receive_json()
        assert closed.value.code == 4403


@pytest.mark.parametrize("role", ["member", "mentor"])
def test_stream_participant_cannot_read_own_history(client, stream_room, role):
    response = client.get(
        f"/api/v1/chat/{stream_room.cid}/messages?chat_backend=own",
        headers={"Authorization": f"Bearer {getattr(stream_room, role)}"},
    )
    assert response.status_code == 404


def test_own_wipe_cannot_end_a_stream_room(client, stream_room):
    response = client.post(
        f"/api/v1/chat/{stream_room.cid}/wipe",
        headers={"Authorization": f"Bearer {stream_room.member}"},
        json={"chat_backend": "own"},
    )
    assert response.status_code == 404
    with TestSession() as db:
        conversation = db.get(Conversation, stream_room.cid)
        assert conversation.status == ConversationStatus.active
        assert conversation.chat_backend == "stream"


@pytest.mark.parametrize("role", ["member_id", "mentor_id"])
def test_single_write_path_refuses_stream_before_scanning(
    db_session, stream_room, monkeypatch, role
):
    def unexpected_scan(_text):
        pytest.fail("Stream-owned room reached own-chat safety/write pipeline")

    monkeypatch.setattr(chat, "scan_message", unexpected_scan)
    with pytest.raises(chat.NotAllowed, match="not_a_participant"):
        chat.send(
            db_session,
            getattr(stream_room, role),
            stream_room.cid,
            client_id="wrong-transport",
            body="hello",
        )
    assert db_session.scalar(select(func.count()).select_from(ChatMessage)) == 0
    assert chat.opening(db_session, stream_room.cid, getattr(stream_room, role), 0) is None


def test_ordinary_orm_room_creation_still_defaults_to_stream(db_session):
    room = seed_chat(db_session)
    conversation = Conversation(user_id=room.member_id, listener_id=room.mentor_id)
    db_session.add(conversation)
    db_session.commit()
    db_session.refresh(conversation)
    assert conversation.chat_backend == "stream"


def _migration():
    path = (
        Path(__file__).resolve().parents[1]
        / "migrations/versions/ea01chat0001_conversation_transport.py"
    )
    spec = importlib.util.spec_from_file_location("conversation_transport_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_migration_preserves_old_rows_and_old_release_inserts(monkeypatch):
    migration = _migration()
    # Exercise the actual PostgreSQL DDL on a connection-local pre-migration table.
    # pg_temp takes precedence over public; the suite's real conversations stay intact.
    with test_engine.begin() as connection:
        connection.execute(
            text("CREATE TEMP TABLE conversations (id text PRIMARY KEY) ON COMMIT DROP")
        )
        connection.execute(text("INSERT INTO conversations (id) VALUES ('existing')"))
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        connection.execute(text("INSERT INTO conversations (id) VALUES ('old-release')"))
        assert connection.execute(
            text("SELECT id, chat_backend FROM conversations ORDER BY id")
        ).all() == [("existing", "stream"), ("old-release", "stream")]
        for invalid in [None, "client-selected"]:
            with pytest.raises(IntegrityError), connection.begin_nested():
                connection.execute(
                    text("UPDATE conversations SET chat_backend = :value WHERE id = 'existing'"),
                    {"value": invalid},
                )
        migration.downgrade()
        assert connection.execute(
            text("SELECT id FROM conversations ORDER BY id")
        ).scalars().all() == ["existing", "old-release"]


def test_schema_downgrade_refuses_to_forget_own_room_ownership(monkeypatch):
    migration = _migration()
    with test_engine.begin() as connection:
        connection.execute(
            text("CREATE TEMP TABLE conversations (id text PRIMARY KEY) ON COMMIT DROP")
        )
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(connection)))
        migration.upgrade()
        connection.execute(
            text("INSERT INTO conversations (id, chat_backend) VALUES ('own-room', 'own')")
        )
        with pytest.raises(RuntimeError, match="Preserve transport ownership"):
            migration.downgrade()
        assert (
            connection.scalar(text("SELECT chat_backend FROM conversations WHERE id = 'own-room'"))
            == "own"
        )
