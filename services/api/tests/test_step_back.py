"""POST /listener-applications/me/step-back — a live mentor's self-serve way toward Start
fresh (board A32 / capture 409, lane u14).

Proves: only a member with an approved, live mentor side can ask (scoping — everyone else
gets 409 `not_live_mentor`, and no session gets 401/403); the ask is idempotent (same time,
first reason kept); it shows the team at the top of the admin Listeners panel with its
reason, and an audit row names the mentor profile, never the member or the reason; the
member's own status reads it back; contact details in the reason are masked; the admin's
existing suspend then lets DELETE /me proceed; reinstating clears the ask.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.main import app
from app.models.admin import AdminAccount, AdminAuditLog
from app.models.enums import AdminRole, ApplicationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.user import User
from app.security import issue_admin_token, issue_session_token
from app.services import stream

from .conftest import TestSession, requires_postgres, test_engine

pytestmark = requires_postgres
API = "/api/v1"


@pytest.fixture(autouse=True)
def _clean(db_session, monkeypatch):
    with test_engine.begin() as conn:
        conn.execute(text("TRUNCATE listener_applications, favourite_listeners, contributions"))
        conn.execute(
            text(
                "DELETE FROM admin_audit_log WHERE action IN "
                "('listener.step_back_requested', 'member.erased')"
            )
        )
    monkeypatch.setattr(stream, "wipe_channel", lambda channel_id: None)
    monkeypatch.setattr(stream, "delete_user", lambda user_id: None)
    monkeypatch.setattr(stream, "seal_channel", lambda *a, **k: None, raising=False)
    yield


@pytest.fixture
def client():
    return TestClient(app)


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def _member_with_mentor_side(
    *, vetting: VettingStatus = VettingStatus.approved, app_status=ApplicationStatus.approved
) -> tuple[str, str]:
    with TestSession() as s:
        u = User(
            persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30
        )
        s.add(u)
        s.flush()
        li = ListenerProfile(
            persona_name="Steady Cedar",
            persona_avatar="a",
            categories=[],
            status=ListenerStatus.online,
            vetting_status=vetting,
            active_conversations=0,
            max_concurrent=3,
        )
        s.add(li)
        s.flush()
        s.add(
            ListenerApplication(
                user_id=u.id,
                motivation="x" * 40,
                communities=["upsc"],
                availability="few_hours",
                status=app_status,
                listener_id=li.id if app_status == ApplicationStatus.approved else None,
                pledge_accepted_at=datetime.now(UTC),
            )
        )
        s.commit()
        return u.id, li.id


def _admin() -> dict:
    with TestSession() as s:
        a = AdminAccount(name="Founder", role=AdminRole.owner)
        s.add(a)
        s.commit()
        return {"Authorization": f"Bearer {issue_admin_token(a.id)}"}


def test_a_live_mentor_asks_and_the_team_sees_it_first(client, db_session):
    member, mentor = _member_with_mentor_side()
    # Someone else, alphabetically first, so "first" is the ask's doing.
    with TestSession() as s:
        s.add(
            ListenerProfile(
                persona_name="Amber Brook",
                persona_avatar="a",
                categories=[],
                vetting_status=VettingStatus.approved,
            )
        )
        s.commit()

    r = client.post(
        f"{API}/listener-applications/me/step-back",
        json={"reason": "Exams start next month. Write to me at me@example.com"},
        headers=_auth(member),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "requested"
    first_at = r.json()["requested_at"]

    # The member's own status reads it back (the sheet's "already asked" state).
    mine = client.get(f"{API}/listener-applications/me", headers=_auth(member)).json()
    assert mine["step_back_requested_at"] == first_at

    rows = client.get(f"{API}/admin/listeners", headers=_admin()).json()
    assert rows[0]["id"] == mentor
    assert rows[0]["step_back_requested_at"] == first_at
    assert "Exams start next month." in rows[0]["step_back_reason"]
    assert "me@example.com" not in rows[0]["step_back_reason"]  # masked like chat
    assert all(r["step_back_requested_at"] is None for r in rows[1:])

    with TestSession() as s:
        audit = s.scalars(
            select(AdminAuditLog).where(AdminAuditLog.action == "listener.step_back_requested")
        ).all()
        assert len(audit) == 1
        assert audit[0].subject_id == mentor
        assert member not in str(audit[0].meta) and "Exams" not in str(audit[0].meta)


def test_asking_again_is_idempotent(client, db_session):
    member, mentor = _member_with_mentor_side()
    url = f"{API}/listener-applications/me/step-back"
    a = client.post(url, json={"reason": "first"}, headers=_auth(member)).json()
    b = client.post(url, json={"reason": "second"}, headers=_auth(member)).json()
    c = client.post(url, headers=_auth(member)).json()  # no body at all is fine
    assert a["requested_at"] == b["requested_at"] == c["requested_at"]
    with TestSession() as s:
        assert s.get(ListenerProfile, mentor).step_back_reason == "first"
        assert (
            len(
                s.scalars(
                    select(AdminAuditLog).where(
                        AdminAuditLog.action == "listener.step_back_requested"
                    )
                ).all()
            )
            == 1
        )


@pytest.mark.parametrize(
    "vetting,app_status",
    [
        (VettingStatus.suspended, ApplicationStatus.approved),  # already stepped back
        (VettingStatus.approved, ApplicationStatus.pending),  # never a mentor yet
        (VettingStatus.approved, ApplicationStatus.declined),
    ],
)
def test_only_a_live_mentor_side_can_ask(client, db_session, vetting, app_status):
    member, _ = _member_with_mentor_side(vetting=vetting, app_status=app_status)
    r = client.post(f"{API}/listener-applications/me/step-back", headers=_auth(member))
    assert r.status_code == 409
    assert r.json()["code"] == "not_live_mentor"


def test_a_plain_member_and_no_session_are_refused(client, db_session):
    with TestSession() as s:
        u = User(
            persona_name="Open Sky", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30
        )
        s.add(u)
        s.commit()
        uid = u.id
    r = client.post(f"{API}/listener-applications/me/step-back", headers=_auth(uid))
    assert r.status_code == 409 and r.json()["code"] == "not_live_mentor"
    assert client.post(f"{API}/listener-applications/me/step-back").status_code in (401, 403)


def test_the_reason_is_bounded(client, db_session):
    member, _ = _member_with_mentor_side()
    r = client.post(
        f"{API}/listener-applications/me/step-back",
        json={"reason": "x" * 281},
        headers=_auth(member),
    )
    assert r.status_code == 422


def test_after_the_team_suspends_start_fresh_proceeds_and_reinstate_clears(client, db_session):
    member, mentor = _member_with_mentor_side()
    assert client.delete(f"{API}/me", headers=_auth(member)).json()["code"] == "mentor_active"
    client.post(f"{API}/listener-applications/me/step-back", headers=_auth(member))

    admin = _admin()
    assert client.post(f"{API}/admin/listeners/{mentor}/suspend", headers=admin).status_code == 200
    # Handled: no longer at the top as a to-do, still readable on the row.
    rows = client.get(f"{API}/admin/listeners", headers=admin).json()
    row = next(r for r in rows if r["id"] == mentor)
    assert row["vetting_status"] == "suspended" and row["step_back_requested_at"]

    # Reinstating settles the ask (a separate member; erasure below removes the first).
    assert (
        client.post(f"{API}/admin/listeners/{mentor}/reinstate", headers=admin).status_code == 200
    )
    with TestSession() as s:
        assert s.get(ListenerProfile, mentor).step_back_requested_at is None
    client.post(f"{API}/admin/listeners/{mentor}/suspend", headers=admin)

    r = client.delete(f"{API}/me", headers=_auth(member))
    assert r.status_code == 200, r.text
    with TestSession() as s:
        assert s.get(User, member) is None
