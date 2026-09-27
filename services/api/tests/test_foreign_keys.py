"""T2.1: real foreign keys with explicit delete rules.

Orphans are rejected at the database, not just avoided by careful code, and each
delete rule does what the privacy promise needs:
- a member's conversations RESTRICT the member's delete — a conversation row is the
  only handle on its Stream channel, so it may only go through erasure (which wipes
  Stream first), never by an implicit cascade;
- rows with nothing outside the database CASCADE (journals, requests, tokens, …);
- detached safety/moderation records SET NULL — the signal stays, the person does not.

Polymorphic owner columns (push_tokens.owner_*, moderation_events.reporter_*) are
enforced by a deferred constraint trigger + parent-delete triggers (Postgres only).
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.exc import IntegrityError

from app.models.contribution import Contribution
from app.models.conversation import Conversation
from app.models.enums import (
    ApplicationStatus,
    JournalChannel,
    ListenerStatus,
    PushOwnerKind,
    ReporterKind,
    VettingStatus,
)
from app.models.journal import JournalEntry
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.mentor_link import MentorLink
from app.models.moderation import ModerationEvent
from app.models.push_token import PushToken
from app.models.reflection import ConversationReflection
from app.models.request import ConversationRequest
from app.models.safety import SafetyFlag
from app.models.user import User

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres

GHOST = "00000000-0000-4000-8000-000000000000"


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, conversations, conversation_requests, "
                "journal_entries, push_tokens, safety_flags, moderation_events, contributions, "
                "listener_applications, conversation_reflections, mentor_links CASCADE"
            )
        )
        s.commit()
    yield


def _user(s) -> str:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _listener(s) -> str:
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
    )
    s.add(li)
    s.flush()
    return li.id


def _convo(s, uid: str, lid: str) -> str:
    c = Conversation(user_id=uid, listener_id=lid)
    s.add(c)
    s.flush()
    return c.id


def _token(owner_kind: PushOwnerKind, owner_id: str, value: str = "ExponentPushToken[x]"):
    return PushToken(
        user_id=owner_id,
        owner_kind=owner_kind,
        owner_id=owner_id,
        expo_push_token=value,
        platform="android",
    )


# --- orphans are rejected -------------------------------------------------------------

ORPHANS = {
    "conversation.user": lambda uid, lid, cid: Conversation(user_id=GHOST, listener_id=lid),
    "conversation.listener": lambda uid, lid, cid: Conversation(user_id=uid, listener_id=GHOST),
    "request.requester": lambda uid, lid, cid: ConversationRequest(requester_id=GHOST),
    "request.target": lambda uid, lid, cid: ConversationRequest(
        requester_id=uid, target_listener_id=GHOST
    ),
    "request.conversation": lambda uid, lid, cid: ConversationRequest(
        requester_id=uid, conversation_id=GHOST
    ),
    "journal.user": lambda uid, lid, cid: JournalEntry(
        user_id=GHOST, channel=JournalChannel.mood, body="x", meta={}
    ),
    "contribution.user": lambda uid, lid, cid: Contribution(user_id=GHOST, amount_paise=100),
    "application.user": lambda uid, lid, cid: ListenerApplication(
        user_id=GHOST,
        motivation="x",
        communities=[],
        availability="weekly",
        pledge_accepted_at=datetime.now(UTC),
    ),
    "application.listener": lambda uid, lid, cid: ListenerApplication(
        user_id=uid,
        motivation="x",
        communities=[],
        availability="weekly",
        status=ApplicationStatus.approved,
        listener_id=GHOST,
        pledge_accepted_at=datetime.now(UTC),
    ),
    "reflection.conversation": lambda uid, lid, cid: ConversationReflection(
        conversation_id=GHOST, energy=3
    ),
    "mentor_link.conversation": lambda uid, lid, cid: MentorLink(
        user_id=uid,
        listener_id=lid,
        conversation_id=GHOST,
        first_met_as="Open River",
        first_met_at=datetime.now(UTC),
    ),
    "push_token.member": lambda uid, lid, cid: _token(PushOwnerKind.member, GHOST),
    "push_token.listener": lambda uid, lid, cid: _token(PushOwnerKind.listener, GHOST),
    # A listener id is not a member: the kind decides which table the id must be in.
    "push_token.wrong_kind": lambda uid, lid, cid: _token(PushOwnerKind.member, lid),
    "moderation.reporter_member": lambda uid, lid, cid: ModerationEvent(
        reporter_id=GHOST, reporter_kind=ReporterKind.member
    ),
    "moderation.reporter_listener": lambda uid, lid, cid: ModerationEvent(
        reporter_id=GHOST, reporter_kind=ReporterKind.listener
    ),
}


@pytest.mark.parametrize("make", ORPHANS.values(), ids=ORPHANS.keys())
def test_orphan_rows_are_rejected(make):
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        cid = _convo(s, uid, lid)
        s.commit()
        s.add(make(uid, lid, cid))
        with pytest.raises(IntegrityError):
            s.commit()  # immediate FKs fail at flush, deferred triggers at commit


def test_rows_with_real_parents_are_accepted():
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        cid = _convo(s, uid, lid)
        s.add_all(
            [
                _token(PushOwnerKind.member, uid),
                _token(PushOwnerKind.listener, lid),
                ModerationEvent(reporter_id=uid, reporter_kind=ReporterKind.member),
                ModerationEvent(reporter_id=lid, reporter_kind=ReporterKind.listener),
                ModerationEvent(reporter_id=None, subject_id=GHOST, conversation_id=GHOST),
                SafetyFlag(user_id=None, conversation_id=GHOST),
                # The crisis scan's sender may be a mentor or an id we do not know:
                # a flag insert is never rejected (it would be read as a dedupe race).
                SafetyFlag(user_id=lid),
                SafetyFlag(user_id=GHOST),
                ConversationRequest(requester_id=uid, target_listener_id=lid, conversation_id=cid),
            ]
        )
        s.commit()


# --- delete rules ---------------------------------------------------------------------


def test_a_member_with_conversations_cannot_be_deleted_behind_erasures_back():
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        _convo(s, uid, lid)
        s.commit()
        with pytest.raises(IntegrityError):
            s.execute(delete(User).where(User.id == uid))
            s.flush()


def test_deleting_a_member_cascades_owned_rows_and_detaches_safety_records():
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        s.add_all(
            [
                JournalEntry(user_id=uid, channel=JournalChannel.mood, body="x", meta={}),
                ConversationRequest(requester_id=uid, target_listener_id=lid),
                Contribution(user_id=uid, amount_paise=100),
                _token(PushOwnerKind.member, uid, "ExponentPushToken[phone]"),
                # The same phone, registered as the mentor — must survive.
                _token(PushOwnerKind.listener, lid, "ExponentPushToken[phone]"),
                SafetyFlag(user_id=uid),
                ModerationEvent(reporter_id=uid, reporter_kind=ReporterKind.member),
                ModerationEvent(reporter_id=lid, reporter_kind=ReporterKind.listener),
            ]
        )
        s.commit()

        s.execute(delete(User).where(User.id == uid))
        s.commit()

        assert s.scalars(select(JournalEntry)).all() == []
        assert s.scalars(select(ConversationRequest)).all() == []
        assert s.scalars(select(Contribution)).all() == []
        tokens = s.scalars(select(PushToken)).all()
        assert [(t.owner_kind, t.owner_id) for t in tokens] == [(PushOwnerKind.listener, lid)]
        assert s.scalars(select(SafetyFlag.user_id)).all() == [None]
        reporters = sorted(s.scalars(select(ModerationEvent.reporter_id)).all(), key=str)
        assert reporters == sorted([None, lid], key=str)


def test_deleting_a_conversation_detaches_requests_and_links_and_drops_reflections():
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        cid = _convo(s, uid, lid)
        s.add_all(
            [
                ConversationRequest(requester_id=uid, conversation_id=cid),
                ConversationReflection(conversation_id=cid, energy=4),
                MentorLink(
                    user_id=uid,
                    listener_id=lid,
                    conversation_id=cid,
                    first_met_as="Open River",
                    first_met_at=datetime.now(UTC),
                ),
                # Safety records keep the id: it only groups flags from the same chat.
                SafetyFlag(user_id=uid, conversation_id=cid),
            ]
        )
        s.commit()

        s.execute(delete(Conversation).where(Conversation.id == cid))
        s.commit()

        assert s.scalars(select(ConversationRequest.conversation_id)).all() == [None]
        assert s.scalars(select(MentorLink.conversation_id)).all() == [None]
        assert s.scalars(select(ConversationReflection)).all() == []
        assert s.scalars(select(SafetyFlag.conversation_id)).all() == [cid]


def test_deleting_a_mentor_profile_drops_their_tokens_and_detaches_their_reports():
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        s.add_all(
            [
                _token(PushOwnerKind.listener, lid),
                ModerationEvent(reporter_id=lid, reporter_kind=ReporterKind.listener),
                SafetyFlag(user_id=lid),
                ListenerApplication(
                    user_id=uid,
                    motivation="x",
                    communities=[],
                    availability="weekly",
                    status=ApplicationStatus.approved,
                    listener_id=lid,
                    pledge_accepted_at=datetime.now(UTC),
                ),
            ]
        )
        s.commit()

        s.execute(delete(ListenerProfile).where(ListenerProfile.id == lid))
        s.commit()

        assert s.scalars(select(PushToken)).all() == []
        assert s.scalars(select(ModerationEvent.reporter_id)).all() == [None]
        assert s.scalars(select(ListenerApplication.listener_id)).all() == [None]
        assert s.scalars(select(SafetyFlag.user_id)).all() == [None]


def test_a_mentors_crisis_message_is_still_flagged():
    """Regression guard for the one column the plan wanted keyed to users: the scan
    runs on EVERY message, and a mentor is not a member."""
    from app.services import safety

    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        cid = _convo(s, uid, lid)
        s.commit()
        result = safety.scan_and_flag(
            s,
            text="honestly I want to die",
            user_id=lid,
            conversation_id=cid,
            stream_message_id="mentor-msg-1",
        )
        assert result.triggered
        flag = s.scalars(select(SafetyFlag)).one()
        assert (flag.user_id, flag.stream_message_id) == (lid, "mentor-msg-1")
