"""Gold mentor invitations (docs/DECISIONS.md §P.2-3): an admin makes a single-use code, a member
claims it and becomes a certified mentor with no application, and nothing identifying is kept."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.main import app
from app.models.admin import AdminAccount, AdminAuditLog
from app.models.enums import AdminRole
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.mentor_invite import MentorInvite
from app.models.user import User
from app.security import issue_admin_token, issue_session_token
from app.services import mentor_invites, stream

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(stream, "ensure_user", lambda *a, **k: True)
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, listener_applications, mentor_invites, "
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


def _member() -> str:
    with TestSession() as s:
        u = User(
            persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30
        )
        s.add(u)
        s.commit()
        return u.id


def _auth(user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def _invite(client, admin_headers, note=None) -> dict:
    r = client.post("/api/v1/admin/mentor-invites", json={"note": note}, headers=admin_headers)
    assert r.status_code == 200, r.text
    return r.json()


def _claim(client, user_id, code, pledge=True):
    return client.post(
        "/api/v1/listener-applications/invite",
        json={"code": code, "pledge_accepted": pledge},
        headers=_auth(user_id),
    )


def test_an_invite_makes_a_certified_mentor_without_an_application(client, admin_headers):
    made = _invite(client, admin_headers, note="cleared mains 2019")
    assert made["status"] == "open" and len(made["code"].replace("-", "")) == 16
    uid = _member()
    r = _claim(client, uid, made["code"])
    assert r.status_code == 200 and r.json()["status"] == "approved"
    assert r.json()["console_active"] is True
    with TestSession() as s:
        li = s.scalars(select(ListenerProfile)).one()
        assert li.certified_exam is True and li.certified_at is not None
        assert li.vetting_status.value == "approved" and li.community_slug == "upsc"
        app_row = s.scalars(select(ListenerApplication)).one()
        assert app_row.user_id == uid and app_row.listener_id == li.id
        invite = s.scalars(select(MentorInvite)).one()
        assert invite.claimed_by == uid and invite.listener_id == li.id


def test_a_code_works_once(client, admin_headers):
    made = _invite(client, admin_headers)
    assert _claim(client, _member(), made["code"]).status_code == 200
    again = _claim(client, _member(), made["code"])
    assert again.status_code == 404


def test_the_code_is_typed_forgivingly(client, admin_headers):
    made = _invite(client, admin_headers)
    messy = made["code"].lower().replace("-", " ")
    assert _claim(client, _member(), messy).status_code == 200


def test_wrong_expired_and_revoked_codes_are_the_same_404(client, admin_headers):
    assert _claim(client, _member(), "AAAA-BBBB-CCCC-DDDD").status_code == 404
    assert _claim(client, _member(), "short").status_code == 404
    expired = _invite(client, admin_headers)
    with TestSession() as s:
        s.get(MentorInvite, expired["id"]).expires_at = datetime.now(UTC) - timedelta(minutes=1)
        s.commit()
    assert _claim(client, _member(), expired["code"]).status_code == 404
    revoked = _invite(client, admin_headers)
    r = client.post(f"/api/v1/admin/mentor-invites/{revoked['id']}/revoke", headers=admin_headers)
    assert r.json()["status"] == "revoked"
    assert _claim(client, _member(), revoked["code"]).status_code == 404


def test_the_pledge_is_still_required(client, admin_headers):
    made = _invite(client, admin_headers)
    assert _claim(client, _member(), made["code"], pledge=False).status_code == 422
    # and the refused tries did not spend the code
    assert _claim(client, _member(), made["code"]).status_code == 200


def test_a_member_with_an_application_on_file_cannot_claim(client, admin_headers):
    uid = _member()
    first = _invite(client, admin_headers)
    assert _claim(client, uid, first["code"]).status_code == 200
    second = _invite(client, admin_headers)
    assert _claim(client, uid, second["code"]).status_code == 409
    with TestSession() as s:  # the second code was not spent
        assert s.get(MentorInvite, second["id"]).claimed_at is None


def test_only_a_hash_is_stored_and_the_list_never_shows_the_code(client, admin_headers):
    made = _invite(client, admin_headers, note="for a friend of the founder")
    with TestSession() as s:
        row = s.get(MentorInvite, made["id"])
        assert made["code"].replace("-", "") not in (row.code_hash, row.note or "")
        assert row.code_hash == mentor_invites._hash(made["code"].replace("-", ""))
    rows = client.get("/api/v1/admin/mentor-invites", headers=admin_headers).json()
    assert rows[0]["note"] == "for a friend of the founder" and "code" not in rows[0]


def test_a_used_invite_cannot_be_revoked_and_actions_are_audited(client, admin_headers):
    made = _invite(client, admin_headers)
    _claim(client, _member(), made["code"])
    r = client.post(f"/api/v1/admin/mentor-invites/{made['id']}/revoke", headers=admin_headers)
    assert r.status_code == 409
    with TestSession() as s:
        actions = [a.action for a in s.scalars(select(AdminAuditLog))]
    assert "mentor_invite.created" in actions


def test_invites_need_an_admin_and_a_signed_in_member(client):
    assert client.post("/api/v1/admin/mentor-invites", json={}).status_code in (401, 403)
    assert client.get("/api/v1/admin/mentor-invites").status_code in (401, 403)
    r = client.post("/api/v1/listener-applications/invite", json={"code": "AAAA-BBBB-CCCC-DDDD"})
    assert r.status_code in (401, 403)
