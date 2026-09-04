"""End-of-conversation reflection — private, idempotent, no identity column."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.reflection import ConversationReflection
from app.models.user import User
from app.security import issue_session_token

from .conftest import TestSession, requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


def _seed(s) -> tuple[str, str]:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add_all([u, li])
    s.flush()
    c = Conversation(
        type="anon",
        status=ConversationStatus.ended,
        user_id=u.id,
        listener_id=li.id,
        stream_channel_id=None,
    )
    s.add(c)
    s.flush()
    return u.id, c.id


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


@requires_postgres
def test_reflection_saves_and_updates_idempotently(client, db_session):
    with TestSession() as s:
        uid, cid = _seed(s)
        s.commit()

    r = client.post(
        f"/api/v1/conversations/{cid}/reflection", json={"energy": 4}, headers=_auth(uid)
    )
    assert r.status_code == 200

    # Re-submitting updates the single row rather than adding another.
    r = client.post(
        f"/api/v1/conversations/{cid}/reflection", json={"energy": 2}, headers=_auth(uid)
    )
    assert r.status_code == 200
    with TestSession() as s:
        rows = s.scalars(select(ConversationReflection)).all()
        assert len(rows) == 1 and rows[0].energy == 2


@requires_postgres
def test_reflection_rejects_out_of_range_and_strangers(client, db_session):
    with TestSession() as s:
        uid, cid = _seed(s)
        stranger = User(
            persona_name="Other Person", persona_avatar="y", dob=date(1995, 1, 1), age_at_signup=31
        )
        s.add(stranger)
        s.flush()
        sid = stranger.id
        s.commit()

    assert (
        client.post(
            f"/api/v1/conversations/{cid}/reflection", json={"energy": 6}, headers=_auth(uid)
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/v1/conversations/{cid}/reflection", json={"energy": 3}, headers=_auth(sid)
        ).status_code
        == 404
    )


def test_reflection_table_has_no_identity_column():
    """T&S #5: the stored reflection must not carry a user identity column."""
    cols = {c.key for c in inspect(ConversationReflection).columns}
    assert "user_id" not in cols
    assert cols == {"id", "conversation_id", "energy", "created_at", "updated_at"}
