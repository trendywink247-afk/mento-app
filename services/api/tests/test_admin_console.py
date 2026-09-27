"""Admin dashboard endpoints: overview counts, safety review + live view + audit,
moderation resolve + suspend, listener CRUD, health, admins + audit."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.admin import AdminAccount, AdminAuditLog
from app.models.conversation import Conversation
from app.models.enums import (
    AdminRole,
    ConversationStatus,
    ListenerStatus,
    SafetySignal,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.safety import SafetyFlag
from app.models.user import User
from app.security import issue_admin_token, issue_session_token
from app.services import stream

from .conftest import TestSession, requires_postgres

APPLY = {
    "motivation": "I've walked the UPSC road twice and know how lonely the wait gets.",
    "communities": ["upsc"],
    "availability": "most_evenings",
    "email": None,
    "mentor_interest": False,
    "pledge_accepted": True,
}


@pytest.fixture(autouse=True)
def _stream_stub(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )
    monkeypatch.setattr(stream, "user_token", lambda uid: f"stub::{uid}")


@pytest.fixture
def client():
    return TestClient(app)


def _admin(s, role=AdminRole.owner) -> str:
    a = AdminAccount(name="Founder", role=role)
    s.add(a)
    s.flush()
    return a.id


def _auth(admin_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_admin_token(admin_id)}"}


def _user(s) -> str:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _listener(s, **kw) -> str:
    li = ListenerProfile(
        persona_name=kw.get("name", "Open River"),
        persona_avatar="river",
        categories=["loneliness"],
        status=ListenerStatus.online,
        vetting_status=kw.get("vetting", VettingStatus.approved),
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


@requires_postgres
def test_overview_counts_exclude_nothing_but_shape_is_right(client, db_session):
    admin_id = _admin(db_session)
    _listener(db_session)
    db_session.commit()
    r = client.get("/api/v1/admin/overview", headers=_auth(admin_id))
    assert r.status_code == 200
    body = r.json()
    for key in (
        "members_today",
        "matches_today",
        "active_conversations",
        "listeners_online",
        "flags_unreviewed",
        "reports_unreviewed",
        "attention",
    ):
        assert key in body
    assert body["listeners_online"] == 1


@requires_postgres
def test_safety_flag_review_writes_audit(client, db_session):
    admin_id = _admin(db_session)
    uid = _user(db_session)
    lid = _listener(db_session)
    c = Conversation(
        type="anon",
        status=ConversationStatus.active,
        user_id=uid,
        listener_id=lid,
        stream_channel_id="c-x1",
    )
    db_session.add(c)
    db_session.flush()
    f = SafetyFlag(conversation_id=c.id, user_id=uid, signal=SafetySignal.self_harm)
    db_session.add(f)
    db_session.commit()

    lst = client.get("/api/v1/admin/safety/flags", headers=_auth(admin_id))
    assert lst.status_code == 200 and len(lst.json()) == 1
    fid = lst.json()[0]["id"]
    assert lst.json()[0]["member_persona"] == "Quiet Cove"

    rev = client.post(
        f"/api/v1/admin/safety/flags/{fid}/review",
        json={"action": "helpline_shown"},
        headers=_auth(admin_id),
    )
    assert rev.status_code == 200
    with TestSession() as s:
        from app.models.safety import SafetyFlag as SF

        assert s.get(SF, fid).reviewed is True
        actions = [a.action for a in s.query(AdminAuditLog).all()]
        assert "flag.reviewed" in actions


@requires_postgres
def test_live_conversation_view_is_audited(client, db_session, monkeypatch):
    monkeypatch.setattr(
        stream,
        "fetch_channel_messages",
        lambda cid: [
            {"id": "m1", "text": "hi", "user_persona": "Quiet Cove", "at": "2026-07-13T00:00:00Z"}
        ],
    )
    admin_id = _admin(db_session)
    uid = _user(db_session)
    lid = _listener(db_session)
    c = Conversation(
        type="anon",
        status=ConversationStatus.active,
        user_id=uid,
        listener_id=lid,
        stream_channel_id="c-x2",
    )
    db_session.add(c)
    db_session.flush()
    # T3.12: a read needs an open case on the conversation and a stated reason.
    db_session.add(SafetyFlag(user_id=uid, conversation_id=c.id, signal=SafetySignal.suicidal))
    db_session.commit()
    r = client.get(
        f"/api/v1/admin/conversations/{c.id}/messages",
        params={"reason": "reviewing the open crisis flag"},
        headers=_auth(admin_id),
    )
    assert r.status_code == 200 and r.json()[0]["text"] == "hi"
    with TestSession() as s:
        assert "conversation.viewed" in [a.action for a in s.query(AdminAuditLog).all()]


@requires_postgres
def test_suspend_listener_revokes_and_audits(client, db_session):
    admin_id = _admin(db_session)
    lid = _listener(db_session)
    db_session.commit()
    r = client.post(f"/api/v1/admin/listeners/{lid}/suspend", headers=_auth(admin_id))
    assert r.status_code == 200
    with TestSession() as s:
        assert s.get(ListenerProfile, lid).vetting_status == VettingStatus.suspended
        assert "listener.suspended" in [a.action for a in s.query(AdminAuditLog).all()]
    assert (
        client.post(f"/api/v1/admin/listeners/{lid}/reinstate", headers=_auth(admin_id)).status_code
        == 200
    )
    with TestSession() as s:
        assert s.get(ListenerProfile, lid).vetting_status == VettingStatus.approved


@requires_postgres
def test_approving_an_application_seeds_availability_note(client, db_session):
    admin_id = _admin(db_session)
    applicant_id = _user(db_session)
    db_session.commit()

    client.post(
        "/api/v1/listener-applications",
        json=APPLY,
        headers={"Authorization": f"Bearer {issue_session_token(applicant_id)}"},
    )
    app_id = client.get(
        "/api/v1/admin/applications?status=pending", headers=_auth(admin_id)
    ).json()[0]["id"]

    r = client.post(f"/api/v1/admin/applications/{app_id}/approve", headers=_auth(admin_id))
    assert r.status_code == 200

    with TestSession() as s:
        li = s.query(ListenerProfile).one()
        assert li.availability_note == "most evenings"  # readable label, not the raw enum slug
        assert li.public_line is None


def test_availability_notes_cover_every_application_literal():
    from typing import get_args

    from app.schemas import ListenerApplicationIn
    from app.services.categories import AVAILABILITY_NOTES

    literal = get_args(ListenerApplicationIn.model_fields["availability"].annotation)
    assert set(literal) <= AVAILABILITY_NOTES.keys()


@requires_postgres
def test_clear_line_nulls_the_line_and_audits(client, db_session):
    admin_id = _admin(db_session)
    lid = _listener(db_session)
    db_session.get(ListenerProfile, lid).public_line = "I mostly just listen."
    db_session.commit()

    r = client.post(f"/api/v1/admin/listeners/{lid}/clear-line", headers=_auth(admin_id))
    assert r.status_code == 200

    with TestSession() as s:
        assert s.get(ListenerProfile, lid).public_line is None
        assert "listener.public_line_cleared" in [a.action for a in s.query(AdminAuditLog).all()]


@requires_postgres
def test_clear_line_helper_can_act_same_as_suspend(client, db_session):
    """Same admin gate as suspend (current_admin, no owner-only restriction) —
    a helper can clear a line just as they can suspend a listener."""
    owner_id = _admin(db_session, role=AdminRole.owner)
    lid = _listener(db_session)
    db_session.commit()
    created = client.post("/api/v1/admin/admins", json={"name": "Helper"}, headers=_auth(owner_id))
    helper_id = created.json()["id"]
    helper_headers = {"Authorization": f"Bearer {issue_admin_token(helper_id)}"}

    r = client.post(f"/api/v1/admin/listeners/{lid}/clear-line", headers=helper_headers)
    assert r.status_code == 200


@requires_postgres
def test_clear_line_unknown_listener_is_404(client, db_session):
    admin_id = _admin(db_session)
    db_session.commit()
    r = client.post("/api/v1/admin/listeners/does-not-exist/clear-line", headers=_auth(admin_id))
    assert r.status_code == 404


@requires_postgres
def test_listener_roster_and_create_and_link(client, db_session):
    admin_id = _admin(db_session)
    _listener(db_session, name="Existing One")
    db_session.commit()
    roster = client.get("/api/v1/admin/listeners", headers=_auth(admin_id))
    assert roster.status_code == 200 and len(roster.json()) >= 1

    created = client.post(
        "/api/v1/admin/listeners",
        json={"categories": ["anxiety"], "max_concurrent": 4},
        headers=_auth(admin_id),
    )
    assert created.status_code == 200
    new_id = created.json()["id"]
    assert created.json()["persona_name"]  # auto-persona

    link = client.post(f"/api/v1/admin/listeners/{new_id}/console-link", headers=_auth(admin_id))
    assert link.status_code == 200 and "#token=" in link.json()["url"]


@requires_postgres
def test_health_deep_shape(client, db_session):
    admin_id = _admin(db_session)
    db_session.commit()
    r = client.get("/api/v1/admin/health/deep", headers=_auth(admin_id))
    assert r.status_code == 200
    for key in ("db_ok", "redis_ok", "stream_configured", "last_webhook_at", "rate_limiter_ok"):
        assert key in r.json()


@requires_postgres
def test_contributions_empty_stub(client, db_session):
    admin_id = _admin(db_session)
    db_session.commit()
    r = client.get("/api/v1/admin/contributions", headers=_auth(admin_id))
    assert r.status_code == 200 and r.json() == []


@requires_postgres
def test_owner_adds_and_revokes_helper_helper_cannot(client, db_session):
    owner_id = _admin(db_session, role=AdminRole.owner)
    db_session.commit()
    created = client.post("/api/v1/admin/admins", json={"name": "Helper"}, headers=_auth(owner_id))
    assert created.status_code == 200
    helper_id = created.json()["id"]
    assert "#token=" in created.json()["url"]
    helper_h = {"Authorization": f"Bearer {issue_admin_token(helper_id)}"}
    assert client.get("/api/v1/admin/admins", headers=helper_h).status_code == 403
    assert (
        client.post(f"/api/v1/admin/admins/{helper_id}/revoke", headers=_auth(owner_id)).status_code
        == 200
    )
    assert client.get("/api/v1/admin/me", headers=helper_h).status_code == 403


@requires_postgres
def test_audit_log_lists_actions(client, db_session):
    owner_id = _admin(db_session)
    lid = _listener(db_session)
    db_session.commit()
    client.post(f"/api/v1/admin/listeners/{lid}/suspend", headers=_auth(owner_id))
    log = client.get("/api/v1/admin/audit", headers=_auth(owner_id))
    assert log.status_code == 200
    assert any(row["action"] == "listener.suspended" for row in log.json())
