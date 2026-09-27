"""T3.9 — the terms gate.

Acceptance is recorded (time + version) at signup or later via POST /me/terms. While
TERMS_GATE_ENFORCED is on, no chat can start without it — neither a General match nor
a Personal request — so no first message can be sent. Off (the default until the
terms text exists and the app that asks for it is out), nothing is refused."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app
from app.models.enums import ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_session_token
from app.services import stream

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
def enforced(monkeypatch):
    monkeypatch.setattr(get_settings(), "terms_gate_enforced", True)


@pytest.fixture
def client():
    return TestClient(app)


def _auth(uid: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _adult() -> str:
    return (datetime.now(UTC).date() - timedelta(days=30 * 366)).isoformat()


def _member(s) -> str:
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
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def test_signup_records_acceptance_with_the_version(client, db_session):
    r = client.post(f"{API}/onboarding/start", json={"dob": _adult(), "terms_accepted": True})
    uid = r.json()["user"]["id"]
    with TestSession() as s:
        u = s.get(User, uid)
        assert u.terms_accepted_at is not None
        assert u.terms_version == get_settings().terms_version
    me = client.get(f"{API}/me", headers=_auth(uid)).json()
    assert me["terms_accepted"] is True and me["terms_required"] is False


def test_signup_without_acceptance_records_nothing(client, db_session):
    uid = client.post(f"{API}/onboarding/start", json={"dob": _adult()}).json()["user"]["id"]
    with TestSession() as s:
        assert s.get(User, uid).terms_accepted_at is None


def test_enforced_no_match_before_acceptance_then_accept_and_match(client, db_session, enforced):
    uid = _member(db_session)
    _listener(db_session)
    db_session.commit()
    assert client.get(f"{API}/me", headers=_auth(uid)).json()["terms_required"] is True
    refused = client.post(f"{API}/match", json={"kind": "general"}, headers=_auth(uid))
    assert refused.status_code == 409 and refused.json()["code"] == "terms_required"

    ok = client.post(f"{API}/me/terms", headers=_auth(uid))
    assert ok.status_code == 200 and ok.json()["terms_accepted"] is True
    assert (
        client.post(f"{API}/match", json={"kind": "general"}, headers=_auth(uid)).status_code == 200
    )


def test_enforced_no_personal_request_before_acceptance(client, db_session, enforced):
    uid = _member(db_session)
    lid = _listener(db_session)
    db_session.commit()
    r = client.post(
        f"{API}/listeners/{lid}/request", json={"intro_message": "hello"}, headers=_auth(uid)
    )
    assert r.status_code == 409 and r.json()["code"] == "terms_required"


def test_an_old_version_is_not_acceptance_of_the_new_one(client, db_session, enforced):
    uid = _member(db_session)
    db_session.commit()
    with TestSession() as s:
        u = s.get(User, uid)
        u.terms_accepted_at = datetime.now(UTC)
        u.terms_version = "an-older-version"
        s.commit()
    assert client.get(f"{API}/me", headers=_auth(uid)).json()["terms_required"] is True


def test_not_enforced_nothing_is_refused(client, db_session):
    uid = _member(db_session)
    _listener(db_session)
    db_session.commit()
    assert client.get(f"{API}/me", headers=_auth(uid)).json()["terms_required"] is False
    assert (
        client.post(f"{API}/match", json={"kind": "general"}, headers=_auth(uid)).status_code == 200
    )
