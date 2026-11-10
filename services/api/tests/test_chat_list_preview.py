"""My Chats rows carry the last line of an own chat, never of a locked or wiped one."""

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
        r = client.get("/api/v1/conversations", headers={"Authorization": f"Bearer {room.member}"})
    assert r.status_code == 200, r.text
    return next(x for x in r.json() if x["id"] == room.cid)


def test_the_latest_line_and_who_wrote_it(db_session):
    room = seed_chat(db_session)
    chat.send(db_session, room.member_id, room.cid, client_id="m1", body="first")
    chat.send(db_session, room.mentor_id, room.cid, client_id="m2", body="Hello - glad you asked")
    row = _row(room)
    assert row["last_message"] == "Hello - glad you asked"
    assert row["last_message_mine"] is False
    assert row["last_message_at"]
    chat.send(db_session, room.member_id, room.cid, client_id="m3", body="thanks")
    row = _row(room)
    assert row["last_message"] == "thanks" and row["last_message_mine"] is True


def test_a_long_or_multiline_message_is_cut_to_one_short_line(db_session):
    room = seed_chat(db_session)
    chat.send(
        db_session,
        room.member_id,
        room.cid,
        client_id="m1",
        body="line one\n\nline   two " + "x" * 300,
    )
    line = _row(room)["last_message"]
    assert "\n" not in line and "  " not in line
    assert len(line) <= 120 and line.endswith("…")


def test_a_locked_chat_leaks_nothing_to_the_list(db_session):
    room = seed_chat(db_session)
    chat.send(db_session, room.member_id, room.cid, client_id="m1", body="private words")
    convo = db_session.get(Conversation, room.cid)
    convo.is_locked = True
    db_session.commit()
    row = _row(room)
    assert row["is_locked"] is True
    assert row["last_message"] is None and row["last_message_at"] is None


def test_no_messages_means_no_preview(db_session):
    room = seed_chat(db_session)
    assert _row(room)["last_message"] is None


def test_an_ended_chat_keeps_its_last_line(db_session):
    room = seed_chat(db_session)
    chat.send(db_session, room.mentor_id, room.cid, client_id="m1", body="take care")
    convo = db_session.get(Conversation, room.cid)
    convo.status = ConversationStatus.ended
    db_session.commit()
    assert _row(room)["last_message"] == "take care"
