"""Listener provisioning integrity (PROGRESS session 22 open items).

1. Stream upsert gap: admin-created and application-approved listeners must be
   upserted to Stream (previously only scripts.seed_listeners did it — in prod a
   fresh listener's first channel creation would fail).
2. Self-match: members can also be approved listeners (session 22 funnel); the
   matcher, Browse list, and Personal-request path must never pair a user with
   their own listener profile.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models.admin import AdminAccount
from app.models.enums import AdminRole, ApplicationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.user import User
from app.security import issue_admin_token, issue_session_token
from app.services import stream

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
                "conversations, conversation_requests, admin_accounts, "
                "admin_audit_log CASCADE"
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


@pytest.fixture
def upserted(monkeypatch):
    """Record every stream.upsert_user call (dev has no Stream creds — the real
    function would just warn-and-skip, which proves nothing)."""
    calls: list[tuple[str, str, str]] = []
    monkeypatch.setattr(
        stream, "upsert_user", lambda uid, name, avatar: calls.append((uid, name, avatar))
    )
    return calls


def _user(s, persona: str = "Quiet Cove") -> str:
    u = User(persona_name=persona, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    s.commit()
    return u.id


def _auth(user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def _listener(s, persona: str, *, online: bool = True) -> str:
    li = ListenerProfile(
        persona_name=persona,
        persona_avatar="x",
        categories=["loneliness"],
        status=ListenerStatus.online if online else ListenerStatus.offline,
        vetting_status=VettingStatus.approved,
        rank=0,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    lid = li.id
    s.commit()
    return lid


def _approved_application(s, user_id: str, listener_id: str) -> None:
    s.add(
        ListenerApplication(
            user_id=user_id,
            motivation="Walked the road, want to hold the lamp for the next person.",
            communities=["upsc"],
            availability="most_evenings",
            status=ApplicationStatus.approved,
            listener_id=listener_id,
            pledge_accepted_at=datetime.now(timezone.utc),
        )
    )
    s.commit()


APPLY = {
    "motivation": "I've walked the UPSC road twice and know how lonely the wait gets.",
    "communities": ["upsc"],
    "availability": "most_evenings",
    "email": None,
    "mentor_interest": False,
    "pledge_accepted": True,
}


# --- Stream upsert gap ----------------------------------------------------------


def test_admin_created_listener_is_upserted_to_stream(client, admin_headers, upserted):
    r = client.post(
        "/api/v1/admin/listeners",
        json={"categories": ["loneliness"], "max_concurrent": 3},
        headers=admin_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["id"], body["persona_name"], body["persona_avatar"]) in upserted


def test_approved_application_listener_is_upserted_to_stream(client, admin_headers, upserted):
    with TestSession() as s:
        uid = _user(s)
    client.post("/api/v1/listener-applications", json=APPLY, headers=_auth(uid))
    app_id = client.get(
        "/api/v1/admin/applications?status=pending", headers=admin_headers
    ).json()[0]["id"]

    assert client.post(
        f"/api/v1/admin/applications/{app_id}/approve", headers=admin_headers
    ).status_code == 200
    with TestSession() as s:
        li = s.query(ListenerProfile).one()
        assert (li.id, li.persona_name, li.persona_avatar) in upserted


# --- Self-match exclusion ---------------------------------------------------------


def test_matcher_never_matches_own_listener_profile(client, monkeypatch):
    """Only listener online = the user's own profile → no match; a second
    listener comes online → matched to the other, never self."""
    # Hand-inserted rows don't exist on Stream — stub the channel call so the
    # test exercises the matcher, not Stream's user registry.
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: f"dev:{channel_id}"
    )
    with TestSession() as s:
        uid = _user(s)
        own = _listener(s, "Quiet Cove")  # minted from this user's application
        _approved_application(s, uid, own)

    r = client.post("/api/v1/match", json={"kind": "general"}, headers=_auth(uid))
    assert r.status_code == 503, r.text  # self is not an available listener

    with TestSession() as s:
        other = _listener(s, "Hushed Grove")
    r = client.post("/api/v1/match", json={"kind": "general"}, headers=_auth(uid))
    assert r.status_code == 200, r.text
    assert r.json()["listener_persona_name"] == "Hushed Grove"
    with TestSession() as s:
        assert s.get(ListenerProfile, other).active_conversations == 1
        assert s.get(ListenerProfile, own).active_conversations == 0


def test_personal_request_to_own_listener_profile_rejected(client):
    with TestSession() as s:
        uid = _user(s)
        own = _listener(s, "Quiet Cove")
        _approved_application(s, uid, own)

    r = client.post(
        f"/api/v1/listeners/{own}/request",
        json={"intro_message": "hello me"},
        headers=_auth(uid),
    )
    assert r.status_code == 403


def test_browse_excludes_own_listener_profile(client):
    with TestSession() as s:
        uid = _user(s)
        own = _listener(s, "Quiet Cove")
        _approved_application(s, uid, own)
        _listener(s, "Hushed Grove")

    names = [li["persona_name"] for li in client.get(
        "/api/v1/listeners", headers=_auth(uid)
    ).json()]
    assert "Hushed Grove" in names
    assert "Quiet Cove" not in names
