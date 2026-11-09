"""DECISIONS section O: the allowance is for certified exam mentors only; an admin certifies."""

from fastapi.testclient import TestClient

from app.main import app
from app.models.listener import ListenerProfile
from app.services import allowance, chat

from .chat_helpers import seed_chat
from .conftest import requires_postgres

pytestmark = requires_postgres


def _send_many(db, room, n):
    for i in range(n):
        chat.send(db, room.member_id, room.cid, client_id=f"c{i}", body=f"message {i}")


def test_general_listening_has_no_cap(db_session):
    room = seed_chat(db_session)  # an ordinary approved mentor
    _send_many(db_session, room, 12)  # past both 3-in-a-row and 10-a-day
    state = allowance.state_for(
        db_session,
        room.member_id,
        db_session.get(
            __import__("app.models.conversation", fromlist=["Conversation"]).Conversation, room.cid
        ),
    )
    assert state.applies is False and state.enforced is False
    assert state.held_reason is None and state.sent_today == 0


def test_a_certified_exam_mentor_keeps_the_cap(db_session):
    room = seed_chat(db_session, certified=True)
    _send_many(db_session, room, 3)
    verdict = allowance.register(db_session, channel_id=room.cid, sender_id=room.member_id)
    # Holding is a setting (off in tests); what matters here is that the cap APPLIES: the
    # member's messages are counted, where a general listener's are not.
    assert verdict is not None
    assert verdict.state.applies is True and verdict.state.sent_today == 4


def test_the_endpoint_says_whether_the_cap_applies(db_session):
    plain = seed_chat(db_session)
    cert = seed_chat(db_session, certified=True)
    with TestClient(app) as client:
        a = client.get(
            f"/api/v1/conversations/{plain.cid}/allowance",
            headers={"Authorization": f"Bearer {plain.member}"},
        )
        b = client.get(
            f"/api/v1/conversations/{cert.cid}/allowance",
            headers={"Authorization": f"Bearer {cert.member}"},
        )
    assert a.status_code == b.status_code == 200
    assert a.json()["applies"] is False
    assert b.json()["applies"] is True


def test_losing_certification_removes_the_cap_going_forward(db_session):
    room = seed_chat(db_session, certified=True)
    li = db_session.get(ListenerProfile, room.mentor_id)
    li.certified_exam = False
    db_session.commit()
    _send_many(db_session, room, 5)
    verdict = allowance.register(db_session, channel_id=room.cid, sender_id=room.member_id)
    assert verdict is None
