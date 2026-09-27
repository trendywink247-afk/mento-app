"""T3.7 — member status, ban and the re-join signal.

A suspended or banned member is refused by every member route (403 with a code the
app can explain) except GET /me; their live chats end and their refresh families are
revoked. Suspension never destroys the anonymous account (refresh still works, so it
is not turned into a sign-out). A new account from the install of a blocked member is
FLAGGED for review, not refused. Every change is audited."""

from __future__ import annotations

import hashlib
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models.admin import AdminAccount, AdminAuditLog
from app.models.conversation import Conversation
from app.models.enums import (
    AdminRole,
    ConversationStatus,
    ListenerStatus,
    MemberStatus,
    ModerationLevel,
    ReporterKind,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.moderation import ModerationEvent
from app.models.user import User
from app.security import issue_admin_token, issue_session_token
from app.services import member_status, stream

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres
API = "/api/v1"


@pytest.fixture(autouse=True)
def _stub_stream(monkeypatch):
    monkeypatch.setattr(stream, "upsert_user", lambda *a, **k: None)
    monkeypatch.setattr(stream, "user_token", lambda uid: f"stub::{uid}")
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )


@pytest.fixture
def client():
    return TestClient(app)


def _auth(uid: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _admin(s) -> AdminAccount:
    a = AdminAccount(name="Founder", role=AdminRole.owner)
    s.add(a)
    s.flush()
    return a


def _member(s, **kw) -> str:
    u = User(
        persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30, **kw
    )
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
        rank=10,
        active_conversations=1,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _adult() -> str:
    return (datetime.now(UTC).date() - timedelta(days=30 * 366)).isoformat()


def test_banned_member_cannot_match_or_list(client, db_session):
    uid = _member(db_session)
    _listener(db_session)
    admin = _admin(db_session)
    member_status.ban(db_session, admin, uid, reason="threats in chat")
    db_session.commit()
    r = client.post(f"{API}/match", json={"kind": "general"}, headers=_auth(uid))
    assert r.status_code == 403 and r.json()["code"] == "member_banned"
    r = client.get(f"{API}/conversations", headers=_auth(uid))
    assert r.status_code == 403


def test_suspended_member_is_refused_but_can_read_their_status(client, db_session):
    uid = _member(db_session)
    admin = _admin(db_session)
    until = datetime.now(UTC) + timedelta(days=3)
    member_status.suspend(db_session, admin, uid, reason="spam", until=until)
    db_session.commit()
    r = client.post(f"{API}/match", json={"kind": "general"}, headers=_auth(uid))
    assert r.status_code == 403 and r.json()["code"] == "member_suspended"
    me = client.get(f"{API}/me", headers=_auth(uid))
    assert me.status_code == 200
    assert me.json()["status"] == "suspended"
    assert me.json()["status_until"].startswith(until.date().isoformat())


def test_an_expired_suspension_no_longer_bites(client, db_session):
    uid = _member(
        db_session,
        status=MemberStatus.suspended,
        banned_until=datetime.now(UTC) - timedelta(minutes=1),
    )
    db_session.commit()
    assert client.get(f"{API}/journals/summary", headers=_auth(uid)).status_code == 200
    assert client.get(f"{API}/me", headers=_auth(uid)).json()["status"] == "active"


def test_suspension_ends_chats_and_is_audited(client, db_session):
    uid = _member(db_session)
    lid = _listener(db_session)
    db_session.add(
        Conversation(
            type="anon",
            status=ConversationStatus.active,
            user_id=uid,
            listener_id=lid,
            stream_channel_id="c-ban",
        )
    )
    admin = _admin(db_session)
    db_session.commit()
    channels = member_status.suspend(db_session, admin, uid, reason="spam")
    db_session.commit()
    assert channels == ["c-ban"]
    with TestSession() as s:
        convo = s.scalars(select(Conversation).where(Conversation.user_id == uid)).one()
        assert convo.status == ConversationStatus.ended
        assert s.get(ListenerProfile, lid).active_conversations == 0
        (row,) = s.scalars(
            select(AdminAuditLog).where(
                AdminAuditLog.action == "member.suspended", AdminAuditLog.subject_id == uid
            )
        ).all()
        assert row.subject_id == uid and row.meta["reason"] == "spam"


def test_suspension_never_signs_the_member_out(client, db_session):
    """The app treats a dead refresh family as a sign-out, and an anonymous account
    cannot be got back — so suspension leaves sessions alone: refresh keeps working
    and the member meets explained 403s until it lapses or is lifted."""
    uid = _member(db_session)
    admin = _admin(db_session)
    db_session.commit()
    pair = client.post(f"{API}/auth/upgrade", headers=_auth(uid)).json()
    member_status.suspend(db_session, admin, uid, reason="spam")
    db_session.commit()
    rotated = client.post(f"{API}/auth/refresh", json={"refresh_token": pair["refresh_token"]})
    assert rotated.status_code == 200
    access = {"Authorization": f"Bearer {rotated.json()['access_token']}"}
    assert client.post(f"{API}/match", json={"kind": "general"}, headers=access).status_code == 403
    assert client.get(f"{API}/me", headers=access).json()["status"] == "suspended"


def test_lift_restores_access_and_is_audited(client, db_session):
    uid = _member(db_session)
    admin = _admin(db_session)
    member_status.ban(db_session, admin, uid, reason="threats")
    db_session.commit()
    member_status.lift(db_session, admin, uid, reason="appeal upheld")
    db_session.commit()
    assert client.get(f"{API}/journals/summary", headers=_auth(uid)).status_code == 200
    with TestSession() as s:
        assert "member.lifted" in [a.action for a in s.scalars(select(AdminAuditLog))]


def test_install_id_is_stored_hashed(client, db_session):
    r = client.post(
        f"{API}/onboarding/start", json={"dob": _adult(), "install_id": "install-abc-123"}
    )
    assert r.status_code == 201
    uid = r.json()["user"]["id"]
    with TestSession() as s:
        u = s.get(User, uid)
        assert u.install_hash == hashlib.sha256(b"install-abc-123").hexdigest()


def test_a_new_account_from_a_banned_install_is_flagged(client, db_session):
    admin = _admin(db_session)
    old = _member(db_session, install_hash=hashlib.sha256(b"install-xyz").hexdigest())
    member_status.ban(db_session, admin, old, reason="threats")
    db_session.commit()

    r = client.post(f"{API}/onboarding/start", json={"dob": _adult(), "install_id": "install-xyz"})
    assert r.status_code == 201  # flagged, not refused
    new = r.json()["user"]["id"]
    with TestSession() as s:
        (event,) = s.scalars(select(ModerationEvent).where(ModerationEvent.subject_id == new)).all()
        assert event.reporter_kind == ReporterKind.system
        assert event.reason == "rejoin_after_ban"
        assert event.reviewed is False

    # A clean install is not flagged.
    other = client.post(f"{API}/onboarding/start", json={"dob": _adult(), "install_id": "fresh"})
    with TestSession() as s:
        assert (
            s.scalars(
                select(ModerationEvent).where(
                    ModerationEvent.subject_id == other.json()["user"]["id"]
                )
            ).all()
            == []
        )


def test_resolving_a_report_with_ban_acts_on_the_member(client, db_session):
    uid = _member(db_session)
    lid = _listener(db_session)
    admin = _admin(db_session)
    event = ModerationEvent(
        reporter_id=lid,
        reporter_kind=ReporterKind.listener,
        subject_id=uid,
        level=ModerationLevel.warning,
        reason="abuse",
    )
    db_session.add(event)
    db_session.commit()
    r = client.post(
        f"{API}/admin/moderation/{event.id}/resolve",
        json={"action": "ban", "reason": "abusive to the mentor"},
        headers={"Authorization": f"Bearer {issue_admin_token(admin.id)}"},
    )
    assert r.status_code == 200
    with TestSession() as s:
        assert s.get(User, uid).status == MemberStatus.banned
        assert s.get(ModerationEvent, event.id).level == ModerationLevel.ban
    assert (
        client.post(f"{API}/match", json={"kind": "general"}, headers=_auth(uid)).status_code == 403
    )


def test_resolve_without_action_changes_no_status(client, db_session):
    uid = _member(db_session)
    admin = _admin(db_session)
    event = ModerationEvent(reporter_kind=ReporterKind.listener, subject_id=uid, reason="spam")
    db_session.add(event)
    db_session.commit()
    r = client.post(
        f"{API}/admin/moderation/{event.id}/resolve",
        headers={"Authorization": f"Bearer {issue_admin_token(admin.id)}"},
    )
    assert r.status_code == 200
    with TestSession() as s:
        assert s.get(User, uid).status == MemberStatus.active
