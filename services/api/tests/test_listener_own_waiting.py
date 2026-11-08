"""The mentor's conversation rows say who is waiting on them, for own chats."""

from fastapi.testclient import TestClient

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus
from app.services import chat

from .chat_helpers import seed_chat
from .conftest import requires_postgres

pytestmark = requires_postgres


def _row(room):
    with TestClient(app) as client:
        r = client.get(
            "/api/v1/listener/me/conversations", headers={"Authorization": f"Bearer {room.mentor}"}
        )
    assert r.status_code == 200, r.text
    return next(x for x in r.json() if x["id"] == room.cid)


def test_no_messages_nobody_is_waiting(db_session):
    row = _row(seed_chat(db_session))
    assert row["waiting_since"] is None and row["unread"] == 0


def test_a_member_message_makes_the_mentor_the_one_waited_on(db_session):
    room = seed_chat(db_session)
    chat.send(db_session, room.member_id, room.cid, client_id="a", body="hello")
    chat.send(db_session, room.member_id, room.cid, client_id="b", body="anyone?")
    row = _row(room)
    assert row["waiting_since"] and row["unread"] == 2


def test_the_mentors_reply_ends_the_wait_but_unread_follows_the_read_marker(db_session):
    room = seed_chat(db_session)
    chat.send(db_session, room.member_id, room.cid, client_id="a", body="hello")
    chat.send(db_session, room.mentor_id, room.cid, client_id="r", body="hi")
    row = _row(room)
    assert row["waiting_since"] is None
    assert row["unread"] == 1  # not marked read yet
    chat.mark_read(db_session, room.cid, room.mentor_id, chat.last_seq(db_session, room.cid))
    db_session.commit()
    assert _row(room)["unread"] == 0


def test_the_wait_starts_at_the_first_unanswered_message(db_session):
    room = seed_chat(db_session)
    chat.send(db_session, room.member_id, room.cid, client_id="a", body="one")
    chat.send(db_session, room.mentor_id, room.cid, client_id="r", body="reply")
    chat.send(db_session, room.member_id, room.cid, client_id="b", body="two")
    since = _row(room)["waiting_since"]
    chat.send(db_session, room.member_id, room.cid, client_id="c", body="three")
    assert _row(room)["waiting_since"] == since


def test_an_ended_chat_reports_no_wait(db_session):
    room = seed_chat(db_session)
    chat.send(db_session, room.member_id, room.cid, client_id="a", body="hello")
    convo = db_session.get(Conversation, room.cid)
    convo.status = ConversationStatus.ended
    db_session.commit()
    row = _row(room)
    assert row["waiting_since"] is None and row["unread"] == 0
