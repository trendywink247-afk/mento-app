"""DELETE /me — Start fresh really erases (audit F24, DECISIONS §L.11).

Proves: every table is empty for the erased member; another member is untouched; active
conversations are ended and the mentor's seats freed; Stream deletion is called for each
channel (and the Stream user); safety records stay but detached; a live mentor is refused
with nothing touched; a Stream failure answers 503 without claiming anything and a retry
completes; the second call is a no-op 200; auth is required.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from app.main import app
from app.models.admin import AdminAuditLog
from app.models.allowance import MessageAllowanceDay
from app.models.conversation import Conversation
from app.models.enums import (
    ApplicationStatus,
    ConversationStatus,
    JournalChannel,
    LinkStatus,
    ListenerStatus,
    PushOwnerKind,
    ReporterKind,
    RequestKind,
    RequestStatus,
    SafetySignal,
    VettingStatus,
)
from app.models.erasure_receipt import ErasureReceipt
from app.models.favourite import FavouriteListener
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
from app.security import issue_listener_token, issue_session_token
from app.services import stream
from app.services.erasure import recovery_digest

from .conftest import TestSession, requires_postgres, test_engine

pytestmark = requires_postgres


@pytest.fixture(autouse=True)
def _clean_extra_tables(db_session):
    """conftest truncates the matching tables; these two are not on its list."""
    with test_engine.begin() as conn:
        conn.execute(text("TRUNCATE listener_applications, favourite_listeners, contributions"))
        conn.execute(text("DELETE FROM admin_audit_log WHERE action = 'member.erased'"))
    yield


@pytest.fixture
def stream_calls(monkeypatch):
    """Record Stream deletions instead of calling Stream. `fail` makes the next N calls
    to the named function raise, like an unreachable Stream would."""
    calls: dict[str, list[str]] = {"wipe": [], "delete_user": []}
    fail: dict[str, int] = {"wipe": 0, "delete_user": 0}

    def _wipe(channel_id: str) -> None:
        if fail["wipe"]:
            fail["wipe"] -= 1
            raise ConnectionError("stream down")
        calls["wipe"].append(channel_id)

    def _delete_user(user_id: str) -> None:
        if fail["delete_user"]:
            fail["delete_user"] -= 1
            raise ConnectionError("stream down")
        calls["delete_user"].append(user_id)

    monkeypatch.setattr(stream, "wipe_channel", _wipe)
    monkeypatch.setattr(stream, "delete_user", _delete_user)
    calls["_fail"] = fail  # type: ignore[assignment] — reason: test-only knob
    return calls


@pytest.fixture
def client():
    return TestClient(app)


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def _user(s, name: str) -> str:
    u = User(
        persona_name=name,
        persona_avatar="x",
        dob=date(1996, 1, 1),
        age_at_signup=30,
        email=f"{name.replace(' ', '').lower()}@example.com",
        community_slug="upsc",
    )
    s.add(u)
    s.flush()
    return u.id


def _listener(s, name: str, *, active: int = 0, vetting=VettingStatus.approved) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="a",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=vetting,
        active_conversations=active,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _convo(s, uid: str, lid: str, status: ConversationStatus, channel: str | None) -> str:
    c = Conversation(
        type="anon", status=status, user_id=uid, listener_id=lid, stream_channel_id=channel
    )
    s.add(c)
    s.flush()
    return c.id


def _world(s, uid: str, lid: str, tag: str) -> dict:
    """Everything a member can leave behind, keyed to `uid`."""
    active = _convo(s, uid, lid, ConversationStatus.active, f"{tag}-active")
    ended = _convo(s, uid, lid, ConversationStatus.ended, f"{tag}-ended")
    wiped = _convo(s, uid, lid, ConversationStatus.wiped, f"{tag}-wiped")
    s.add_all(
        [
            JournalEntry(user_id=uid, channel=JournalChannel.mood, body="a heavy day", meta={}),
            JournalEntry(
                user_id=uid,
                channel=JournalChannel.mentor_notes,
                body="breathe first",
                source="chat",
                meta={"conversation_id": active},
            ),
            FavouriteListener(user_id=uid, listener_id=lid),
            MentorLink(
                user_id=uid,
                listener_id=lid,
                conversation_id=active,
                status=LinkStatus.accepted,
                first_met_as="Open River",
                first_met_at=datetime.now(UTC),
            ),
            ConversationRequest(
                kind=RequestKind.personal,
                status=RequestStatus.pending,
                requester_id=uid,
                target_listener_id=lid,
                intro_message="hello",
            ),
            PushToken(
                user_id=uid,
                owner_kind=PushOwnerKind.member,
                owner_id=uid,
                expo_push_token=f"ExponentPushToken[{tag}]",
                platform="android",
            ),
            MessageAllowanceDay(user_id=uid, day=date(2026, 9, 19), sent=3),
            ConversationReflection(conversation_id=ended, energy=4),
            SafetyFlag(
                conversation_id=active,
                user_id=uid,
                signal=SafetySignal.suicidal,
                matched_terms="want to die",
            ),
            ModerationEvent(
                reporter_id=uid,
                reporter_kind=ReporterKind.member,
                subject_id=lid,
                conversation_id=ended,
                reason="rude",
            ),
            ModerationEvent(
                reporter_id=lid,
                reporter_kind=ReporterKind.listener,
                subject_id=uid,
                conversation_id=active,
                reason="spam",
            ),
        ]
    )
    s.flush()
    return {"active": active, "ended": ended, "wiped": wiped}


def _count(s, model, *where) -> int:
    return s.scalar(select(func.count()).select_from(model).where(*where))


def _rows_for(s, uid: str, convo_ids: list[str]) -> dict[str, int]:
    return {
        "users": _count(s, User, User.id == uid),
        "conversations": _count(s, Conversation, Conversation.user_id == uid),
        "journals": _count(s, JournalEntry, JournalEntry.user_id == uid),
        "favourites": _count(s, FavouriteListener, FavouriteListener.user_id == uid),
        "links": _count(s, MentorLink, MentorLink.user_id == uid),
        "requests": _count(s, ConversationRequest, ConversationRequest.requester_id == uid),
        "push": _count(s, PushToken, PushToken.owner_id == uid),
        "allowance": _count(s, MessageAllowanceDay, MessageAllowanceDay.user_id == uid),
        "reflections": _count(
            s, ConversationReflection, ConversationReflection.conversation_id.in_(convo_ids)
        ),
        "applications": _count(s, ListenerApplication, ListenerApplication.user_id == uid),
        "flags_with_id": _count(s, SafetyFlag, SafetyFlag.user_id == uid),
        "reports_by": _count(s, ModerationEvent, ModerationEvent.reporter_id == uid),
        "reports_about": _count(s, ModerationEvent, ModerationEvent.subject_id == uid),
    }


def test_erase_empties_every_table_frees_seats_and_leaves_others_alone(
    client, db_session, stream_calls
):
    with TestSession() as s:
        me = _user(s, "Quiet Cove")
        other = _user(s, "Bright Hill")
        # The mentor holds two seats: one for my active chat, one for the other member's.
        lid = _listener(s, "Open River", active=2)
        mine = _world(s, me, lid, "me")
        theirs = _world(s, other, lid, "them")
        s.add(
            ListenerApplication(
                user_id=me,
                motivation="x" * 40,
                communities=["upsc"],
                availability="few_hours",
                pledge_accepted_at=datetime.now(UTC),
            )
        )
        s.commit()
    before_other = None
    with TestSession() as s:
        before_other = _rows_for(s, other, list(theirs.values()))

    r = client.delete("/api/v1/me", headers=_auth(me))
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "erased"}

    with TestSession() as s:
        rows = _rows_for(s, me, list(mine.values()))
        assert all(v == 0 for v in rows.values()), rows
        # The other member is untouched, row for row.
        assert _rows_for(s, other, list(theirs.values())) == before_other
        assert s.get(Conversation, theirs["active"]).status == ConversationStatus.active
        # My active chat ended through the one end path: exactly one seat freed.
        assert s.get(ListenerProfile, lid).active_conversations == 1
        # The mentor is still there (only the member identity goes).
        assert s.get(ListenerProfile, lid) is not None
        # Safety records stay, detached from the person.
        flags = s.scalars(
            select(SafetyFlag).where(SafetyFlag.conversation_id == mine["active"])
        ).all()
        assert len(flags) == 1 and flags[0].user_id is None
        assert flags[0].signal == SafetySignal.suicidal
        by_me = s.scalars(
            select(ModerationEvent).where(ModerationEvent.conversation_id == mine["ended"])
        ).one()
        assert by_me.reporter_id is None and by_me.subject_id == lid
        about_me = s.scalars(
            select(ModerationEvent).where(
                ModerationEvent.conversation_id == mine["active"],
                ModerationEvent.reporter_kind == ReporterKind.listener,
            )
        ).one()
        assert about_me.subject_id is None and about_me.reporter_id == lid
        # One audit row: that an erasure happened, counts only — never who.
        audit = s.scalars(
            select(AdminAuditLog).where(AdminAuditLog.action == "member.erased")
        ).all()
        assert len(audit) == 1
        assert audit[0].subject_id is None
        assert me not in str(audit[0].meta) and "Quiet Cove" not in str(audit[0].meta)
        assert audit[0].meta["conversations"] == 3
        receipts = s.scalars(select(ErasureReceipt)).all()
        assert len(receipts) == 1
        assert receipts[0].member_digest == recovery_digest(me)
        assert receipts[0].member_digest != me

    # Stream: every channel still on Stream (not the one Clean Wipe already deleted),
    # then the Stream user.
    assert sorted(stream_calls["wipe"]) == ["me-active", "me-ended"]
    assert stream_calls["delete_user"] == [me]

    # The session is now an unknown one everywhere else.
    assert client.get("/api/v1/me", headers=_auth(me)).status_code == 401


def test_second_call_is_a_noop_200(client, db_session, stream_calls):
    with TestSession() as s:
        me = _user(s, "Quiet Cove")
        _world(s, me, _listener(s, "Open River", active=1), "me")
        s.commit()
    assert client.delete("/api/v1/me", headers=_auth(me)).status_code == 200
    calls_after_first = (list(stream_calls["wipe"]), list(stream_calls["delete_user"]))
    again = client.delete("/api/v1/me", headers=_auth(me))
    assert again.status_code == 200 and again.json() == {"status": "erased"}
    assert (stream_calls["wipe"], stream_calls["delete_user"]) == calls_after_first
    with TestSession() as s:
        assert _count(s, AdminAuditLog, AdminAuditLog.action == "member.erased") == 1


def test_auth_required(client, db_session):
    assert client.delete("/api/v1/me").status_code in (401, 403)
    # A mentor's token must not erase anything either (roles never cross endpoints).
    with TestSession() as s:
        lid = _listener(s, "Open River")
        s.commit()
    r = client.delete(
        "/api/v1/me", headers={"Authorization": f"Bearer {issue_listener_token(lid)}"}
    )
    assert r.status_code in (401, 403)


def test_stream_failure_claims_nothing_and_a_retry_completes(client, db_session, stream_calls):
    with TestSession() as s:
        me = _user(s, "Quiet Cove")
        lid = _listener(s, "Open River", active=1)
        mine = _world(s, me, lid, "me")
        s.commit()

    stream_calls["_fail"]["delete_user"] = 1  # channels go, the Stream user does not
    r = client.delete("/api/v1/me", headers=_auth(me))
    assert r.status_code == 503
    assert r.json()["code"] == "erase_incomplete"
    with TestSession() as s:
        # Nothing claimed: the member and their journal are still there…
        assert s.get(User, me) is not None
        assert _count(s, JournalEntry, JournalEntry.user_id == me) == 2
        # …but the chat is ended and the seat is free (phase A committed).
        assert s.get(Conversation, mine["active"]).status == ConversationStatus.wiped
        assert s.get(ListenerProfile, lid).active_conversations == 0
        # The waiting request left the mentor's inbox; the link is ended.
        assert (
            _count(
                s,
                ConversationRequest,
                ConversationRequest.requester_id == me,
                ConversationRequest.status == RequestStatus.pending,
            )
            == 0
        )
        assert s.scalars(select(MentorLink).where(MentorLink.user_id == me)).one().status == (
            LinkStatus.ended
        )
    assert sorted(stream_calls["wipe"]) == ["me-active", "me-ended"]

    retry = client.delete("/api/v1/me", headers=_auth(me))
    assert retry.status_code == 200
    # Channels already deleted are not deleted again; the user is.
    assert sorted(stream_calls["wipe"]) == ["me-active", "me-ended"]
    assert stream_calls["delete_user"] == [me]
    with TestSession() as s:
        assert all(v == 0 for v in _rows_for(s, me, list(mine.values())).values())
        # The seat was freed once, not twice.
        assert s.get(ListenerProfile, lid).active_conversations == 0


def test_channel_failure_mid_way_is_503(client, db_session, stream_calls):
    with TestSession() as s:
        me = _user(s, "Quiet Cove")
        _world(s, me, _listener(s, "Open River", active=1), "me")
        s.commit()
    stream_calls["_fail"]["wipe"] = 1
    r = client.delete("/api/v1/me", headers=_auth(me))
    assert r.status_code == 503 and r.json()["code"] == "erase_incomplete"
    assert stream_calls["delete_user"] == []
    with TestSession() as s:
        assert s.get(User, me) is not None
    assert client.delete("/api/v1/me", headers=_auth(me)).status_code == 200


def test_live_mentor_is_refused_and_nothing_is_touched(client, db_session, stream_calls):
    """Dual role: an approved application whose mentor profile is live → 409."""
    with TestSession() as s:
        me = _user(s, "Quiet Cove")
        my_mentor_side = _listener(s, "Steady Cedar")
        other_mentor = _listener(s, "Open River", active=1)
        mine = _world(s, me, other_mentor, "me")
        s.add(
            ListenerApplication(
                user_id=me,
                motivation="x" * 40,
                communities=["upsc"],
                availability="few_hours",
                status=ApplicationStatus.approved,
                listener_id=my_mentor_side,
                pledge_accepted_at=datetime.now(UTC),
            )
        )
        s.commit()
        before = _rows_for(s, me, list(mine.values()))

    r = client.delete("/api/v1/me", headers=_auth(me))
    assert r.status_code == 409
    assert r.json()["code"] == "mentor_active"
    with TestSession() as s:
        assert _rows_for(s, me, list(mine.values())) == before
        assert s.get(Conversation, mine["active"]).status == ConversationStatus.active
        assert s.get(ListenerProfile, other_mentor).active_conversations == 1
        assert s.get(ListenerProfile, my_mentor_side) is not None
    assert stream_calls["wipe"] == [] and stream_calls["delete_user"] == []


def test_a_suspended_mentor_side_does_not_block_erasure(client, db_session, stream_calls):
    """The mentor side is no longer live — the member may erase; the (suspended) mentor
    profile itself stays with its own identity."""
    with TestSession() as s:
        me = _user(s, "Quiet Cove")
        mentor_side = _listener(s, "Steady Cedar", vetting=VettingStatus.suspended)
        s.add(
            ListenerApplication(
                user_id=me,
                motivation="x" * 40,
                communities=["upsc"],
                availability="few_hours",
                status=ApplicationStatus.approved,
                listener_id=mentor_side,
                pledge_accepted_at=datetime.now(UTC),
            )
        )
        s.commit()
    assert client.delete("/api/v1/me", headers=_auth(me)).status_code == 200
    with TestSession() as s:
        assert s.get(User, me) is None
        assert _count(s, ListenerApplication, ListenerApplication.user_id == me) == 0
        assert s.get(ListenerProfile, mentor_side) is not None


def test_erasure_does_not_send_own_room_aliases_to_stream(db_session, monkeypatch):
    from app.models.chat_message import ChatMessage
    from app.services.erasure import erase_member

    def forbidden(*args, **kwargs):
        raise AssertionError("Own room alias must never be sent to Stream")

    monkeypatch.setattr(stream, "erase_channel", forbidden)
    # Current onboarding provisions a Stream identity even before owning a room;
    # that identity must still be erased during the staged provider transition.
    removed_users = []
    monkeypatch.setattr(stream, "delete_user", removed_users.append)
    with TestSession() as s:
        me = _user(s, "Synthetic owner")
        lid = _listener(s, "Synthetic mentor", active=2)
        rooms = _world(s, me, lid, "own")
        for room in s.scalars(select(Conversation).where(Conversation.user_id == me)):
            room.chat_backend = "own"
        s.add(
            ChatMessage(
                conversation_id=rooms["active"],
                sender_kind="member",
                sender_id=me,
                seq=1,
                client_id="synthetic",
                body=b"synthetic ciphertext",
                key_id="test",
            )
        )
        s.commit()
        assert erase_member(s, me) is not None
    with TestSession() as s:
        assert s.get(User, me) is None
        assert (
            s.scalar(
                select(func.count()).select_from(ChatMessage).where(ChatMessage.sender_id == me)
            )
            == 0
        )
    assert removed_users == [me]


@pytest.mark.parametrize("owner_kind", ["member", "listener"])
def test_bulk_safety_end_never_returns_own_room_alias(db_session, owner_kind):
    from app.services import conversations

    with TestSession() as s:
        me = _user(s, "Synthetic owner")
        lid = _listener(s, "Synthetic mentor", active=2)
        rooms = _world(s, me, lid, "own")
        for room in s.scalars(select(Conversation).where(Conversation.user_id == me)):
            room.chat_backend = "own"
        s.commit()
        if owner_kind == "member":
            channels = conversations.end_all_for_member(s, me)
        else:
            channels = conversations.end_all_for_listener(s, lid)
        assert channels and all(channel is None for channel in channels)
        s.commit()
        assert s.get(Conversation, rooms["active"]).status == ConversationStatus.ended


def test_recovery_receipt_rolls_back_with_account_deletion(db_session):
    from app.services.erasure import _phase_c_delete

    with TestSession() as s:
        me = _user(s, "Quiet Cove")
        s.commit()
        _phase_c_delete(s, me)
        s.flush()
        assert s.get(ErasureReceipt, recovery_digest(me)) is not None
        s.rollback()
    with TestSession() as s:
        assert s.get(User, me) is not None
        assert s.get(ErasureReceipt, recovery_digest(me)) is None


def test_isolated_recovery_reconciles_old_snapshot_without_provider_calls(db_session, monkeypatch):
    from app.services import chat_events
    from app.services.recovery_reconciliation import reconcile_restored_members

    def forbidden(*args, **kwargs):
        raise AssertionError("Recovery must not contact serving integrations")

    monkeypatch.setattr(stream, "delete_user", forbidden)
    monkeypatch.setattr(stream, "erase_channel", forbidden)
    monkeypatch.setattr(chat_events, "after_commit", forbidden)
    with TestSession() as s:
        me, other = _user(s, "Quiet Cove"), _user(s, "Other Cove")
        lid = _listener(s, "Open River", active=2)
        mine = _world(s, me, lid, "me")
        theirs = _world(s, other, lid, "them")
        s.commit()
    # Receipt arrived after this restored snapshot was taken.
    with TestSession() as s:
        assert reconcile_restored_members(s, {recovery_digest(me)}) == 1
        s.commit()
    with TestSession() as s:
        assert all(v == 0 for v in _rows_for(s, me, list(mine.values())).values())
        assert s.get(User, other) is not None
        assert s.get(Conversation, theirs["active"]).status == ConversationStatus.active
        assert s.get(ListenerProfile, lid).active_conversations == 1
        assert reconcile_restored_members(s, {recovery_digest(me)}) == 0
        assert s.get(ErasureReceipt, recovery_digest(me)) is not None


def test_recovery_rejects_malformed_receipts_before_changes(db_session):
    from app.services.recovery_reconciliation import reconcile_restored_members

    with TestSession() as s:
        me = _user(s, "Quiet Cove")
        s.commit()
        with pytest.raises(ValueError):
            reconcile_restored_members(s, {recovery_digest(me), "bad"})
        assert s.get(User, me) is not None
        assert s.get(ErasureReceipt, recovery_digest(me)) is None


def test_recovery_reconciliation_is_transactional(db_session):
    from app.services.recovery_reconciliation import reconcile_restored_members

    with TestSession() as s:
        me = _user(s, "Quiet Cove")
        lid = _listener(s, "Open River", active=1)
        mine = _world(s, me, lid, "me")
        s.commit()
        reconcile_restored_members(s, {recovery_digest(me)})
        s.flush()
        s.rollback()
    with TestSession() as s:
        assert s.get(User, me) is not None
        assert s.get(Conversation, mine["active"]).status == ConversationStatus.active
        assert s.get(ListenerProfile, lid).active_conversations == 1
        assert s.get(ErasureReceipt, recovery_digest(me)) is None


def test_independent_receiver_export_verified_before_database_replay(
    db_session, monkeypatch, tmp_path
):
    from pathlib import Path

    from app.services.recovery_manifest import checkpoint_receipt_export
    from app.services.recovery_reconciliation import reconcile_restored_export

    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2]))
    from recovery_receiver.store import Store, canonical, initialize

    store_path = tmp_path / "independent-receipts.sqlite3"
    initialize(store_path)
    receiver = Store(store_path)
    old_export = canonical(receiver.export())
    with TestSession() as s:
        me, other = _user(s, "Synthetic erased"), _user(s, "Synthetic retained")
        s.commit()
    receiver.record(recovery_digest(me))
    recovered_export = canonical(receiver.export())
    witness = checkpoint_receipt_export(recovered_export)
    with TestSession() as s:
        with pytest.raises(ValueError):
            reconcile_restored_export(s, old_export, witness)
        assert s.get(User, me) is not None
        assert reconcile_restored_export(s, recovered_export, witness) == 1
        s.rollback()
    with TestSession() as s:
        assert s.get(User, me) is not None
        assert reconcile_restored_export(s, recovered_export, witness) == 1
        s.commit()
    with TestSession() as s:
        assert s.get(User, me) is None
        assert s.get(User, other) is not None
        assert reconcile_restored_export(s, recovered_export, witness) == 0


def test_receipt_ack_failure_retains_account_for_retry(
    client, db_session, stream_calls, monkeypatch
):
    from app.services import recovery_receipts

    with TestSession() as s:
        me = _user(s, "Quiet Cove")
        s.commit()

    def unavailable(digest):
        raise recovery_receipts.ReceiptUnavailable("synthetic")

    monkeypatch.setattr(recovery_receipts, "acknowledge", unavailable)
    assert client.delete("/api/v1/me", headers=_auth(me)).status_code == 503
    with TestSession() as s:
        assert s.get(User, me) is not None
        assert s.get(ErasureReceipt, recovery_digest(me)) is None
    seen = []
    monkeypatch.setattr(recovery_receipts, "acknowledge", seen.append)
    assert client.delete("/api/v1/me", headers=_auth(me)).status_code == 200
    assert seen == [recovery_digest(me)]
