"""The Personal-request accept path (audit F4): one request opens one conversation,
and never for a suspended mentor or a member who has since blocked that mentor."""

from __future__ import annotations

import threading
from datetime import date

import pytest

from app.models.conversation import Conversation
from app.models.enums import (
    ListenerStatus,
    ModerationLevel,
    RequestKind,
    RequestStatus,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.moderation import ModerationEvent
from app.models.request import ConversationRequest
from app.models.user import User
from app.services import matching, stream

from .conftest import TestSession, requires_postgres


@pytest.fixture(autouse=True)
def _stream_stub(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )


def _seed(s, *, vetting=VettingStatus.approved) -> tuple[str, str, str]:
    u = User(persona_name="Misty Vale", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=vetting,
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
        intro_message="hello",
    )
    s.add(req)
    s.flush()
    return u.id, li.id, req.id


@requires_postgres
def test_the_same_request_accepted_twice_opens_one_conversation(db_session, monkeypatch):
    """Double tap, or the admin stand-in racing the mentor. Both callers load the
    request as `pending`; the loser used to keep that stale copy through the listener
    lock and open a SECOND conversation + slot for the same request."""
    with TestSession() as s:
        _, lid, rid = _seed(s)
        s.commit()

    barrier = threading.Barrier(2)
    original = matching._pending_request

    def _both_see_pending(db, request_id, acting_listener_id):
        req = original(db, request_id, acting_listener_id)
        try:
            barrier.wait(timeout=1.5)  # line both callers up just after the load
        except threading.BrokenBarrierError:
            pass  # the fix: the second caller is still blocked on the row lock
        return req

    monkeypatch.setattr(matching, "_pending_request", _both_see_pending)

    results: list[str] = []

    def worker() -> None:
        session = TestSession()
        try:
            matching.accept_personal_request(session, rid, acting_listener_id=lid)
            results.append("matched")
        except matching.RequestNotPending:
            session.rollback()
            results.append("not_pending")
        finally:
            session.close()

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)

    assert sorted(results) == ["matched", "not_pending"]
    with TestSession() as s:
        assert s.query(Conversation).filter(Conversation.listener_id == lid).count() == 1
        assert s.get(ListenerProfile, lid).active_conversations == 1


@requires_postgres
def test_a_suspended_mentor_cannot_be_given_a_conversation(db_session):
    """The admin stand-in path has no `current_listener` vetting check in front of it."""
    with TestSession() as s:
        _, lid, rid = _seed(s, vetting=VettingStatus.suspended)
        s.commit()
    with TestSession() as s, pytest.raises(matching.RequestNotPending):
        matching.accept_personal_request(s, rid)
    with TestSession() as s:
        assert s.query(Conversation).count() == 0
        assert s.get(ListenerProfile, lid).active_conversations == 0


@requires_postgres
def test_a_block_after_the_request_closes_it_instead_of_opening_a_chat(db_session):
    with TestSession() as s:
        uid, lid, rid = _seed(s)
        s.add(
            ModerationEvent(
                reporter_id=uid,
                subject_id=lid,
                level=ModerationLevel.suspension,
                blocked=True,
                reviewed=False,
            )
        )
        s.commit()
    with TestSession() as s, pytest.raises(matching.RequestNotPending):
        matching.accept_personal_request(s, rid, acting_listener_id=lid)
    with TestSession() as s:
        assert s.query(Conversation).count() == 0
        assert s.get(ConversationRequest, rid).status == RequestStatus.declined
        assert s.get(ListenerProfile, lid).active_conversations == 0
