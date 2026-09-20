"""The question a member asked opens the thread they get.

A Personal request carries the member's question (`intro_message`). Until 20 Sep it only
ever lived in our database: the mentor accepted a question they then could not see in the
chat, and the member opened a thread missing the thing they wrote. It is now posted into
the channel, as the member, the moment the mentor accepts.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.models.enums import ListenerStatus, RequestKind, RequestStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.request import ConversationRequest
from app.models.user import User
from app.services import matching, stream

from .conftest import TestSession, requires_postgres

QUESTION = "I keep freezing in mocks and I do not know how to start again."


@pytest.fixture
def posted(monkeypatch) -> list[tuple[str, str, str]]:
    """Every server-side send, as (channel_id, user_id, text)."""
    sent: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )
    monkeypatch.setattr(
        stream,
        "post_message",
        lambda channel_id, user_id, text: sent.append((channel_id, user_id, text)) or "m-1",
    )
    return sent


def _seed(s, *, question: str | None = QUESTION) -> tuple[str, str, str]:
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
        intro_message=question,
    )
    s.add(req)
    s.commit()
    return u.id, li.id, req.id


@requires_postgres
def test_the_question_is_the_first_message(db_session, posted):
    with TestSession() as s:
        member_id, _listener_id, request_id = _seed(s)

    with TestSession() as s:
        req = matching.accept_personal_request(s, request_id)
        assert req.conversation_id is not None  # the request carries the chat it opened

    assert len(posted) == 1, "the member's question must open the thread"
    posted_channel, posted_user, posted_text = posted[0]
    assert posted_text == QUESTION
    # In the member's OWN name — it is their question, not a system note from us.
    assert posted_user == member_id
    assert posted_channel


@requires_postgres
def test_a_request_with_no_question_posts_nothing(db_session, posted):
    with TestSession() as s:
        _seed(s, question=None)
        request_id = s.query(ConversationRequest).one().id

    with TestSession() as s:
        matching.accept_personal_request(s, request_id)

    assert posted == []


@requires_postgres
def test_a_stream_hiccup_never_undoes_an_accepted_conversation(db_session, monkeypatch):
    """The mentor has already said yes and the chat is already open — a failed post must
    not roll that back. The mentor still has the question on the request card."""
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )

    def boom(channel_id: str, user_id: str, text: str) -> str:
        raise RuntimeError("stream is having a moment")

    monkeypatch.setattr(stream, "post_message", boom)

    with TestSession() as s:
        _member_id, _listener_id, request_id = _seed(s)

    with TestSession() as s:
        req = matching.accept_personal_request(s, request_id)
        assert req.status == RequestStatus.matched
        assert req.conversation_id is not None
