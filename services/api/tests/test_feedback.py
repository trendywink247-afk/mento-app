"""Product feedback (board A11): either side of the app may send it; it is stored
without identity; bounded, rate-limited, PII-redacted; a crisis in the box is answered
with helplines; the admin list is paginated, scoped and audited.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import ratelimit
from app.main import app
from app.models.admin import AdminAccount, AdminAuditLog
from app.models.enums import AdminRole, AdminStatus, ListenerStatus, VettingStatus
from app.models.feedback import ProductFeedback
from app.models.listener import ListenerProfile
from app.models.safety import SafetyFlag
from app.models.user import User
from app.security import issue_admin_token, issue_listener_token, issue_session_token

from .conftest import TestSession, requires_postgres

URL = "/api/v1/feedback"
ADMIN_URL = "/api/v1/admin/feedback"


@pytest.fixture
def client():
    return TestClient(app)


def _member(s) -> str:
    u = User(
        persona_name="Gentle Harbor",
        persona_avatar="x",
        dob=date(1997, 5, 17),
        age_at_signup=29,
        email="someone@example.com",
    )
    s.add(u)
    s.commit()
    return u.id


def _mentor(s, vetting=VettingStatus.approved) -> str:
    li = ListenerProfile(
        persona_name="Steady Cedar",
        persona_avatar="owl",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=vetting,
    )
    s.add(li)
    s.commit()
    return li.id


def _u(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def _l(listener_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_listener_token(listener_id)}"}


def _admin(s, role=AdminRole.helper) -> tuple[str, dict]:
    a = AdminAccount(name="Helper", role=role)
    s.add(a)
    s.commit()
    return a.id, {"Authorization": f"Bearer {issue_admin_token(a.id)}"}


GOOD = {
    "category": "confusing",
    "text": "  I could not tell whether my note was saved.  ",
    "screen": "(tabs)/journals",
    "app_version": "0.1.0 (35)",
}


@requires_postgres
def test_a_member_and_a_mentor_can_both_send_it_and_no_identity_is_stored(client, db_session):
    member, mentor = _member(db_session), _mentor(db_session)
    r = client.post(URL, json=GOOD, headers=_u(member))
    assert (r.status_code, r.json()) == (200, {"status": "received", "crisis": None})
    r = client.post(URL, json={"category": "idea", "text": "A calmer tab bar."}, headers=_l(mentor))
    assert r.status_code == 200

    with TestSession() as s:
        rows = s.scalars(select(ProductFeedback).order_by(ProductFeedback.created_at)).all()
    assert [(f.role, f.category) for f in rows] == [("member", "confusing"), ("mentor", "idea")]
    assert rows[0].text == "I could not tell whether my note was saved."  # trimmed
    assert (rows[0].screen, rows[0].app_version) == ("(tabs)/journals", "0.1.0 (35)")
    assert (rows[1].screen, rows[1].app_version) == (None, None)

    # The table cannot hold an author: no column could, and no value does.
    columns = {c.name for c in ProductFeedback.__table__.columns}
    assert columns == {
        "id",
        "created_at",
        "updated_at",
        "role",
        "category",
        "text",
        "screen",
        "app_version",
    }
    for f in rows:
        stored = " ".join(str(getattr(f, c)) for c in columns)
        assert member not in stored and mentor not in stored


@requires_postgres
def test_who_may_send(client, db_session):
    assert client.post(URL, json=GOOD).status_code in (401, 403)
    _id, admin = _admin(db_session)
    assert client.post(URL, json=GOOD, headers=admin).status_code == 401
    # A token for an account that no longer exists / a mentor who is not approved.
    assert client.post(URL, json=GOOD, headers=_u(str(uuid.uuid4()))).status_code == 401
    suspended = _mentor(db_session, VettingStatus.suspended)
    assert client.post(URL, json=GOOD, headers=_l(suspended)).status_code == 403
    with TestSession() as s:
        assert s.scalars(select(ProductFeedback)).all() == []


@requires_postgres
@pytest.mark.parametrize(
    "bad",
    [
        {"category": "rant", "text": "x"},  # closed set of chips
        {"category": "idea", "text": "   "},  # blank
        {"category": "idea", "text": "x" * 1001},  # bounded
        {"category": "idea", "text": "ok", "screen": "chat/9f1c… what I typed to my mentor"},
        {"category": "idea", "text": "ok", "screen": "s" * 65},
        {"category": "idea", "text": "ok", "app_version": "v" * 33},
        {"category": "idea"},
    ],
)
def test_bounds(client, db_session, bad):
    member = _member(db_session)
    assert client.post(URL, json=bad, headers=_u(member)).status_code == 422


@requires_postgres
def test_contact_details_are_redacted_before_they_are_kept(client, db_session):
    member = _member(db_session)
    text = "It crashed. Call me on 9876543210 or write to aspirant@example.com please."
    assert (
        client.post(URL, json={"category": "broken", "text": text}, headers=_u(member)).status_code
        == 200
    )
    with TestSession() as s:
        stored = s.scalars(select(ProductFeedback)).one().text
    assert "9876543210" not in stored and "aspirant@example.com" not in stored
    assert stored.startswith("It crashed.")


@requires_postgres
def test_a_crisis_in_the_box_gets_the_helplines_and_the_words_are_not_kept(client, db_session):
    member = _member(db_session)
    r = client.post(
        URL, json={"category": "idea", "text": "honestly I want to die"}, headers=_u(member)
    )
    assert r.status_code == 200
    assert r.json()["status"] == "support"
    crisis = r.json()["crisis"]
    assert crisis["signal"] == "suicidal"
    assert crisis["support"]
    assert any(h["number"] == "14416" for h in crisis["helplines"])
    with TestSession() as s:
        flag = s.scalars(select(SafetyFlag)).one()
        assert (flag.user_id, flag.conversation_id) == (member, None)  # human review
        assert flag.matched_terms == "suicidal"  # signal only, never the words
        assert s.scalars(select(ProductFeedback)).all() == []  # not kept as feedback


@requires_postgres
def test_rate_limited_per_author(client, db_session, monkeypatch):
    member, other = _member(db_session), _mentor(db_session)
    monkeypatch.setattr(ratelimit, "ENABLED", True)
    try:
        for _ in range(5):
            assert client.post(URL, json=GOOD, headers=_u(member)).status_code == 200
        limited = client.post(URL, json=GOOD, headers=_u(member))
        assert limited.status_code == 429
        assert "little while" in limited.json()["detail"]
        # Someone else's box is not affected.
        assert client.post(URL, json=GOOD, headers=_l(other)).status_code == 200
        # The helplines are never rate-limited — but nothing more is stored.
        heavy = client.post(
            URL, json={"category": "idea", "text": "I want to die"}, headers=_u(member)
        )
        assert heavy.status_code == 200
        assert heavy.json()["status"] == "support"
        assert any(h["number"] == "14416" for h in heavy.json()["crisis"]["helplines"])
        with TestSession() as s:
            assert s.scalars(select(SafetyFlag)).all() == []  # …and no flag flood
    finally:
        r = ratelimit._redis()
        r.delete(f"rl:feedback:member:{member}", f"rl:feedback:mentor:{other}")
    with TestSession() as s:
        assert len(s.scalars(select(ProductFeedback)).all()) == 6


# --- admin -----------------------------------------------------------------------


@requires_postgres
def test_admin_list_is_paginated_filtered_and_audited(client, db_session):
    member, mentor = _member(db_session), _mentor(db_session)
    for i in range(7):
        body = {"category": "broken" if i % 2 else "idea", "text": f"note {i}", "screen": "coffee"}
        assert client.post(URL, json=body, headers=_u(member)).status_code == 200
    client.post(URL, json={"category": "idea", "text": "from a mentor"}, headers=_l(mentor))
    admin_id, admin = _admin(db_session)

    page = client.get(f"{ADMIN_URL}?limit=3", headers=admin).json()
    assert (page["total"], page["limit"], page["offset"]) == (8, 3, 0)
    assert [i["text"] for i in page["items"]] == [
        "from a mentor",
        "note 6",
        "note 5",
    ]  # newest first
    assert set(page["items"][0]) == {
        "id",
        "created_at",
        "role",
        "category",
        "text",
        "screen",
        "app_version",
    }
    last = client.get(f"{ADMIN_URL}?limit=3&offset=6", headers=admin).json()
    assert [i["text"] for i in last["items"]] == ["note 1", "note 0"]

    broken = client.get(f"{ADMIN_URL}?category=broken", headers=admin).json()
    assert broken["total"] == 3 and all(i["category"] == "broken" for i in broken["items"])
    mentors = client.get(f"{ADMIN_URL}?role=mentor", headers=admin).json()
    assert [i["text"] for i in mentors["items"]] == ["from a mentor"]
    assert client.get(f"{ADMIN_URL}?limit=101", headers=admin).status_code == 422
    assert client.get(f"{ADMIN_URL}?category=rant", headers=admin).status_code == 422

    raw = client.get(ADMIN_URL, headers=admin).text
    assert member not in raw and mentor not in raw and "someone@example.com" not in raw

    with TestSession() as s:
        logs = s.scalars(
            select(AdminAuditLog)
            .where(AdminAuditLog.action == "feedback.viewed", AdminAuditLog.admin_id == admin_id)
            .order_by(AdminAuditLog.created_at)
        ).all()
    assert len(logs) == 5
    assert logs[0].admin_id == admin_id
    assert logs[0].meta == {"limit": 3, "offset": 0, "category": None, "role": None}


@requires_postgres
def test_admin_list_refuses_everyone_else(client, db_session):
    member, mentor = _member(db_session), _mentor(db_session)
    assert client.get(ADMIN_URL).status_code in (401, 403)
    assert client.get(ADMIN_URL, headers=_u(member)).status_code == 401
    assert client.get(ADMIN_URL, headers=_l(mentor)).status_code == 401
    admin_id, admin = _admin(db_session)
    assert client.get(ADMIN_URL, headers=admin).status_code == 200
    with TestSession() as s:
        s.get(AdminAccount, admin_id).status = AdminStatus.revoked
        s.commit()
    assert client.get(ADMIN_URL, headers=admin).status_code == 403
