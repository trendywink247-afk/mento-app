"""Listener applications: lifecycle, one-open constraint, cooldown, privacy."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models.enums import ApplicationStatus
from app.models.listener_application import ListenerApplication
from app.models.user import User
from app.security import issue_session_token

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(text("TRUNCATE users, listener_profiles, listener_applications CASCADE"))
        s.commit()
    yield


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


def test_requires_auth(client):
    assert client.get("/api/v1/listener-applications/me").status_code in (401, 403)
    assert client.post("/api/v1/listener-applications", json=PAYLOAD).status_code in (401, 403)
