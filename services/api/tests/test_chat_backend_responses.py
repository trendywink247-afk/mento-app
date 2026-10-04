"""Participants read persisted transport ownership; client hints never choose it."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.conversation import Conversation

from .chat_helpers import seed_chat
from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.mark.parametrize("backend", ["stream", "own"])
def test_member_and_mentor_lists_expose_stored_transport(db_session, backend):
    room = seed_chat(db_session)
    db_session.get(Conversation, room.cid).chat_backend = backend
    db_session.commit()
    forged = "own" if backend == "stream" else "stream"
    with TestClient(app) as client:
        for path, token in [
            ("/api/v1/conversations", room.member),
            ("/api/v1/listener/me/conversations", room.mentor),
        ]:
            response = client.get(
                path,
                params={"chat_backend": forged},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert response.status_code == 200, response.text
            item = next(item for item in response.json() if item["id"] == room.cid)
            assert item["chat_backend"] == backend
        state = client.post(
            f"/api/v1/conversations/{room.cid}/pause",
            json={"paused": True, "chat_backend": forged},
            headers={"Authorization": f"Bearer {room.member}"},
        )
        assert state.status_code == 200, state.text
        assert state.json()["chat_backend"] == backend
        direct = client.get(
            f"/api/v1/conversations/{room.cid}/state",
            params={"chat_backend": forged},
            headers={"Authorization": f"Bearer {room.member}"},
        )
        assert direct.status_code == 200
        assert direct.json()["chat_backend"] == backend
    with TestSession() as db:
        assert db.get(Conversation, room.cid).chat_backend == backend


def test_transport_list_remains_participant_scoped(db_session):
    room = seed_chat(db_session)
    other = seed_chat(db_session)
    with TestClient(app) as client:
        for path, token in [
            ("/api/v1/conversations", other.member),
            ("/api/v1/listener/me/conversations", other.mentor),
        ]:
            response = client.get(path, headers={"Authorization": f"Bearer {token}"})
            assert response.status_code == 200
            assert all(item["id"] != room.cid for item in response.json())
        response = client.post(
            f"/api/v1/conversations/{room.cid}/pause",
            json={"paused": True},
            headers={"Authorization": f"Bearer {other.member}"},
        )
        assert response.status_code == 404
        state = client.get(
            f"/api/v1/conversations/{room.cid}/state",
            headers={"Authorization": f"Bearer {other.member}"},
        )
        assert state.status_code == 404
