"""Own chat for new conversations (docs/DECISIONS.md §M, step 1): the setting picks the backend
at match time, an own-chat match never touches Stream, the member's question opens the thread
through the one write path, and the capacity sweep does not mistake it for a crashed match."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.config import get_settings
from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    ListenerStatus,
    RequestKind,
    RequestStatus,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.request import ConversationRequest
from app.models.user import User
from app.services import chat, matching, stream

from .conftest import TestSession, requires_postgres


@pytest.fixture
def channels(monkeypatch):
    """Records Stream channel creation; own chat must never call it."""
    made: list[str] = []

    def create(channel_id, user_id, listener_id):
        made.append(channel_id)
        return channel_id

    monkeypatch.setattr(stream, "create_dm_channel", create)
    monkeypatch.setattr(stream, "post_message", lambda *a, **k: None)
    return made


def _seed(s, intro="hello from a member") -> tuple[str, str, str]:
    u = User(persona_name="Misty Vale", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
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
    req = ConversationRequest(
        kind=RequestKind.personal,
        status=RequestStatus.pending,
        requester_id=u.id,
        target_listener_id=li.id,
        intro_message=intro,
    )
    s.add(req)
    s.flush()
    return u.id, li.id, req.id


@requires_postgres
def test_default_is_still_a_stream_channel(db_session, channels):
    with TestSession() as s:
        _, lid, rid = _seed(s)
        s.commit()
        req = matching.accept_personal_request(s, rid, acting_listener_id=lid)
        convo = s.get(Conversation, req.conversation_id)
        assert convo.chat_backend == "stream"
        assert convo.stream_channel_id is not None
        assert len(channels) == 1


@requires_postgres
def test_setting_on_opens_an_own_chat_conversation_without_stream(
    db_session, channels, monkeypatch
):
    monkeypatch.setattr(get_settings(), "own_chat_new_conversations", True)
    with TestSession() as s:
        uid, lid, rid = _seed(s)
        s.commit()
        req = matching.accept_personal_request(s, rid, acting_listener_id=lid)
        convo = s.get(Conversation, req.conversation_id)
        assert convo.chat_backend == "own"
        assert convo.stream_channel_id is None
        assert channels == []
        assert convo.status == ConversationStatus.active
        assert s.get(ListenerProfile, lid).active_conversations == 1


@requires_postgres
def test_the_members_question_opens_the_own_chat_thread(db_session, channels, monkeypatch):
    monkeypatch.setattr(get_settings(), "own_chat_new_conversations", True)
    with TestSession() as s:
        uid, lid, rid = _seed(s, intro="I could use a listening ear")
        s.commit()
        req = matching.accept_personal_request(s, rid, acting_listener_id=lid)
        thread = chat.history(s, req.conversation_id)
        assert [m["text"] for m in thread] == ["I could use a listening ear"]
        assert thread[0]["sender_kind"] == "member"
        assert thread[0]["seq"] == 1


@requires_postgres
def test_the_question_goes_through_the_crisis_scan(db_session, channels, monkeypatch):
    """The intro is not a side door: it uses chat.send, so the scan runs on it too."""
    monkeypatch.setattr(get_settings(), "own_chat_new_conversations", True)
    seen: list[str] = []
    real = chat.scan_message
    monkeypatch.setattr(chat, "scan_message", lambda text: (seen.append(text), real(text))[1])
    with TestSession() as s:
        _, lid, rid = _seed(s, intro="a first question")
        s.commit()
        matching.accept_personal_request(s, rid, acting_listener_id=lid)
    assert seen == ["a first question"]


@requires_postgres
def test_capacity_sweep_keeps_an_old_own_chat_conversation_but_ends_an_orphaned_stream_one(
    db_session, channels, monkeypatch
):
    monkeypatch.setattr(get_settings(), "own_chat_new_conversations", True)
    with TestSession() as s:
        _, lid, rid = _seed(s)
        s.commit()
        req = matching.accept_personal_request(s, rid, acting_listener_id=lid)
        own_id = req.conversation_id
        orphan = Conversation(
            user_id=req.requester_id,
            listener_id=lid,
            status=ConversationStatus.active,
            chat_backend="stream",
            stream_channel_id=None,
        )
        s.add(orphan)
        s.flush()
        old = datetime.now(UTC) - timedelta(minutes=10)
        s.execute(
            update(Conversation)
            .where(Conversation.id.in_([own_id, orphan.id]))
            .values(created_at=old)
        )
        s.commit()
        orphan_id = orphan.id

        matching.reconcile_listener_capacity(s)
        s.expire_all()
        status = dict(s.execute(select(Conversation.id, Conversation.status)).all())
        assert status[own_id] == ConversationStatus.active
        assert status[orphan_id] == ConversationStatus.ended


@requires_postgres
def test_allowlisted_member_gets_own_chat_while_everyone_else_stays_on_stream(
    db_session, channels, monkeypatch
):
    """The per-user switch: the global setting is off, so a Stream-only build is never handed
    an own-chat room, but a member on the allowlist is."""
    with TestSession() as s:
        uid_a, lid_a, rid_a = _seed(s)
        uid_b, lid_b, rid_b = _seed(s)
        s.commit()
    monkeypatch.setattr(get_settings(), "own_chat_user_ids", f" {uid_a} , other-id ")
    with TestSession() as s:
        a = s.get(
            Conversation,
            matching.accept_personal_request(s, rid_a, acting_listener_id=lid_a).conversation_id,
        )
        b = s.get(
            Conversation,
            matching.accept_personal_request(s, rid_b, acting_listener_id=lid_b).conversation_id,
        )
        assert (a.chat_backend, a.stream_channel_id is None) == ("own", True)
        assert (b.chat_backend, b.stream_channel_id is None) == ("stream", False)
        assert len(channels) == 1
