"""DECISIONS section O: a non-certified mentor can suggest a certified exam mentor."""

from fastapi.testclient import TestClient

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus
from app.models.listener import ListenerProfile

from .chat_helpers import seed_chat
from .conftest import requires_postgres

pytestmark = requires_postgres


def _suggest(room):
    with TestClient(app) as client:
        return client.post(
            f"/api/v1/listener/me/conversations/{room.cid}/suggest-certified",
            headers={"Authorization": f"Bearer {room.mentor}"},
        )


def _state(room):
    with TestClient(app) as client:
        return client.get(
            f"/api/v1/conversations/{room.cid}/state",
            headers={"Authorization": f"Bearer {room.member}"},
        ).json()


def test_the_member_sees_the_suggestion_and_the_chat_stays_open(db_session):
    room = seed_chat(db_session)
    assert _state(room)["exam_redirect"] is False
    assert _suggest(room).status_code == 200
    state = _state(room)
    assert state["exam_redirect"] is True and state["status"] == "active"


def test_suggesting_twice_is_harmless(db_session):
    room = seed_chat(db_session)
    assert _suggest(room).status_code == 200
    first = db_session.get(Conversation, room.cid).exam_redirect_at
    db_session.expire_all()
    assert _suggest(room).status_code == 200
    assert db_session.get(Conversation, room.cid).exam_redirect_at == first


def test_a_certified_mentor_has_nobody_to_hand_it_to(db_session):
    room = seed_chat(db_session, certified=True)
    r = _suggest(room)
    assert r.status_code == 409 and r.json()["code"] == "already_certified"


def test_only_this_mentors_own_active_conversation(db_session):
    room = seed_chat(db_session)
    other = seed_chat(db_session)
    with TestClient(app) as client:
        r = client.post(
            f"/api/v1/listener/me/conversations/{room.cid}/suggest-certified",
            headers={"Authorization": f"Bearer {other.mentor}"},
        )
    assert r.status_code == 404
    convo = db_session.get(Conversation, room.cid)
    convo.status = ConversationStatus.ended
    db_session.commit()
    assert _suggest(room).status_code == 409


def test_the_mentor_is_not_certified_by_suggesting(db_session):
    room = seed_chat(db_session)
    _suggest(room)
    db_session.expire_all()
    assert db_session.get(ListenerProfile, room.mentor_id).certified_exam is False
