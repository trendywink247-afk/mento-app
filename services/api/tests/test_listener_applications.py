"""Listener applications: lifecycle, one-open constraint, cooldown, privacy."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models.admin import AdminAccount, AdminAuditLog
from app.models.enums import AdminRole, ApplicationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.user import User
from app.security import issue_admin_token, issue_session_token

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, listener_applications, "
                "admin_accounts, admin_audit_log CASCADE"
            )
        )
        s.commit()
    yield


@pytest.fixture
def admin_headers():
    with TestSession() as s:
        a = AdminAccount(name="Founder", role=AdminRole.owner)
        s.add(a)
        s.flush()
        admin_id = a.id
        s.commit()
    return {"Authorization": f"Bearer {issue_admin_token(admin_id)}"}


def _user(s) -> str:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    s.commit()
    return u.id


def _auth(user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


PAYLOAD = {
    "motivation": "I've walked the UPSC road twice and know how lonely the wait after prelims gets.",
    "communities": ["upsc"],
    "availability": "most_evenings",
    "email": None,
    "mentor_interest": True,
    "pledge_accepted": True,
}


def test_apply_then_status(client):
    with TestSession() as s:
        uid = _user(s)
    r = client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["mentor_interest"] is True
    assert body["console_url"] is None

    me = client.get("/api/v1/listener-applications/me", headers=_auth(uid))
    assert me.status_code == 200
    assert me.json()["status"] == "pending"


def test_no_application_yet_returns_null(client):
    with TestSession() as s:
        uid = _user(s)
    r = client.get("/api/v1/listener-applications/me", headers=_auth(uid))
    assert r.status_code == 200
    assert r.json() is None


def test_pledge_required(client):
    with TestSession() as s:
        uid = _user(s)
    r = client.post(
        "/api/v1/listener-applications",
        json={**PAYLOAD, "pledge_accepted": False},
        headers=_auth(uid),
    )
    assert r.status_code == 422


def test_unknown_community_rejected(client):
    with TestSession() as s:
        uid = _user(s)
    r = client.post(
        "/api/v1/listener-applications",
        json={**PAYLOAD, "communities": ["hogwarts"]},
        headers=_auth(uid),
    )
    assert r.status_code == 422


def test_invalid_email_rejected(client):
    with TestSession() as s:
        uid = _user(s)
    r = client.post(
        "/api/v1/listener-applications",
        json={**PAYLOAD, "email": "not-an-email"},
        headers=_auth(uid),
    )
    assert r.status_code == 422


def test_one_open_application(client):
    with TestSession() as s:
        uid = _user(s)
    assert client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid)).status_code == 200
    r = client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid))
    assert r.status_code == 409


def test_declined_cooldown_then_reapply(client):
    with TestSession() as s:
        uid = _user(s)
    assert client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid)).status_code == 200
    fresh_decline = datetime.now(timezone.utc)
    with TestSession() as s:
        s.query(ListenerApplication).update(
            {"status": ApplicationStatus.declined, "decline_reason": "internal note", "updated_at": fresh_decline}
        )
        s.commit()
    # Inside the 30-day cooldown → blocked.
    assert client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid)).status_code == 409
    # Age the decline past the cooldown → allowed again.
    with TestSession() as s:
        s.query(ListenerApplication).update({"updated_at": fresh_decline - timedelta(days=31)})
        s.commit()
    assert client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid)).status_code == 200


def test_decline_reason_never_in_member_payload(client):
    with TestSession() as s:
        uid = _user(s)
    client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid))
    with TestSession() as s:
        s.query(ListenerApplication).update(
            {"status": ApplicationStatus.declined, "decline_reason": "internal note"}
        )
        s.commit()
    body = client.get("/api/v1/listener-applications/me", headers=_auth(uid)).json()
    assert body["status"] == "declined"
    assert "decline_reason" not in body
    assert "internal note" not in str(body)


def test_suspended_listener_gets_no_console_url(client):
    """Approved application whose listener was later suspended must not mint a
    console link (T&S #9: suspension revokes access instantly)."""
    with TestSession() as s:
        uid = _user(s)
    client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid))
    with TestSession() as s:
        li = ListenerProfile(
            persona_name="Hushed Grove",
            persona_avatar="x",
            categories=["loneliness"],
            status=ListenerStatus.online,
            vetting_status=VettingStatus.suspended,
            rank=10,
            active_conversations=0,
            max_concurrent=3,
        )
        s.add(li)
        s.flush()
        s.query(ListenerApplication).update(
            {"status": ApplicationStatus.approved, "listener_id": li.id}
        )
        s.commit()
    body = client.get("/api/v1/listener-applications/me", headers=_auth(uid)).json()
    assert body["status"] == "approved"
    assert body["console_url"] is None


def test_requires_auth(client):
    assert client.get("/api/v1/listener-applications/me").status_code in (401, 403)
    assert client.post("/api/v1/listener-applications", json=PAYLOAD).status_code in (401, 403)


# --- Admin half ---------------------------------------------------------------


def test_admin_queue_approve_creates_listener(client, admin_headers):
    with TestSession() as s:
        uid = _user(s)
    client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid))

    q = client.get("/api/v1/admin/applications?status=pending", headers=admin_headers)
    assert q.status_code == 200
    items = q.json()
    assert len(items) == 1
    assert items[0]["persona_name"] == "Quiet Cove"
    app_id = items[0]["id"]

    ok = client.post(f"/api/v1/admin/applications/{app_id}/approve", headers=admin_headers)
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "approved"

    # Approval must create a REAL listener, ready for the matcher.
    with TestSession() as s:
        li = s.query(ListenerProfile).filter_by(persona_name="Quiet Cove").one()
        assert li.vetting_status == VettingStatus.approved
        assert "listener.application_approved" in [
            a.action for a in s.query(AdminAuditLog).all()
        ]

    # The member now sees an approved card with a working console link.
    me = client.get("/api/v1/listener-applications/me", headers=_auth(uid)).json()
    assert me["status"] == "approved"
    assert me["console_url"] and "/listener#token=" in me["console_url"]

    # Approving again is a conflict.
    assert client.post(
        f"/api/v1/admin/applications/{app_id}/approve", headers=admin_headers
    ).status_code == 409


def test_admin_decline_records_private_reason(client, admin_headers):
    with TestSession() as s:
        uid = _user(s)
    client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid))
    app_id = client.get(
        "/api/v1/admin/applications?status=pending", headers=admin_headers
    ).json()[0]["id"]

    r = client.post(
        f"/api/v1/admin/applications/{app_id}/decline",
        json={"reason": "needs more lived experience"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    with TestSession() as s:
        assert "listener.application_declined" in [
            a.action for a in s.query(AdminAuditLog).all()
        ]
    me = client.get("/api/v1/listener-applications/me", headers=_auth(uid)).json()
    assert me["status"] == "declined"
    assert "needs more lived experience" not in str(me)


def test_admin_endpoints_require_admin(client):
    assert client.get("/api/v1/admin/applications").status_code in (401, 403)
    # Auth must reject before any lookup — a made-up id never 404s here.
    assert client.post("/api/v1/admin/applications/nope/approve").status_code in (401, 403)
    assert client.post(
        "/api/v1/admin/applications/nope/decline", json={"reason": "why not"}
    ).status_code in (401, 403)
