"""T3.10 — one-time mentor console links.

Polling the application status no longer mints a 30-day console token. An approved
mentor asks for a code (POST /listener-applications/me/console-code): 10 minutes,
single use, stored only as a hash. The web console trades it once for a listener
session (POST /listener/session/exchange); suspension is honoured at the trade."""

from __future__ import annotations

import hashlib
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.main import app
from app.models.console_code import ConsoleCode
from app.models.enums import ApplicationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.user import User
from app.security import issue_session_token

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres

CODE = "/api/v1/listener-applications/me/console-code"
EXCHANGE = "/api/v1/listener/session/exchange"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(
            text("TRUNCATE users, listener_profiles, listener_applications, console_codes CASCADE")
        )
        s.commit()
    yield


def _mentor(vetting=VettingStatus.approved, status=ApplicationStatus.approved) -> tuple[str, str]:
    with TestSession() as s:
        u = User(
            persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30
        )
        li = ListenerProfile(
            persona_name="Hushed Grove",
            persona_avatar="x",
            categories=[],
            status=ListenerStatus.away,
            vetting_status=vetting,
            rank=10,
            active_conversations=0,
            max_concurrent=3,
        )
        s.add_all([u, li])
        s.flush()
        s.add(
            ListenerApplication(
                user_id=u.id,
                motivation="m" * 40,
                communities=["upsc"],
                availability="most_evenings",
                mentor_interest=False,
                pledge_accepted_at=datetime.now(UTC),
                status=status,
                listener_id=li.id,
            )
        )
        s.commit()
        return u.id, li.id


def _auth(uid: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def test_status_poll_mints_no_token(client):
    uid, _ = _mentor()
    body = client.get("/api/v1/listener-applications/me", headers=_auth(uid)).json()
    assert body["console_url"] is None
    assert body["console_active"] is True
    assert "eyJ" not in str(body)  # no JWT anywhere in the poll


def test_code_is_single_use_and_opens_the_console(client):
    uid, lid = _mentor()
    minted = client.post(CODE, headers=_auth(uid))
    assert minted.status_code == 200
    body = minted.json()
    assert body["console_url"].endswith(f"/listener#code={body['code']}")
    first = client.post(EXCHANGE, json={"code": body["code"]})
    assert first.status_code == 200
    session = first.json()
    assert session["listener_id"] == lid
    me = client.get(
        "/api/v1/listener/me", headers={"Authorization": f"Bearer {session['listener_token']}"}
    )
    assert me.status_code == 200
    again = client.post(EXCHANGE, json={"code": body["code"]})
    assert again.status_code == 401


def test_codes_are_stored_hashed_and_last_ten_minutes(client):
    uid, _ = _mentor()
    body = client.post(CODE, headers=_auth(uid)).json()
    with TestSession() as s:
        row = s.scalars(select(ConsoleCode)).one()
        assert row.code_hash == hashlib.sha256(body["code"].encode()).hexdigest()
        assert body["code"] not in (row.id, row.code_hash)
        ttl = row.expires_at - row.created_at
        assert timedelta(minutes=9) < ttl <= timedelta(minutes=10)


def test_expired_code_is_refused(client):
    uid, _ = _mentor()
    body = client.post(CODE, headers=_auth(uid)).json()
    with TestSession() as s:
        s.execute(text("UPDATE console_codes SET expires_at = now() - interval '1 second'"))
        s.commit()
    assert client.post(EXCHANGE, json={"code": body["code"]}).status_code == 401


def test_unknown_code_is_refused(client):
    assert client.post(EXCHANGE, json={"code": "not-a-code"}).status_code == 401


@pytest.mark.parametrize(
    ("vetting", "status"),
    [
        (VettingStatus.suspended, ApplicationStatus.approved),
        (VettingStatus.approved, ApplicationStatus.pending),
    ],
)
def test_only_a_live_mentor_gets_a_code(client, vetting, status):
    uid, _ = _mentor(vetting, status)
    assert client.post(CODE, headers=_auth(uid)).status_code == 403


def test_suspension_after_the_code_is_honoured_at_the_exchange(client):
    uid, lid = _mentor()
    body = client.post(CODE, headers=_auth(uid)).json()
    with TestSession() as s:
        s.get(ListenerProfile, lid).vetting_status = VettingStatus.suspended
        s.commit()
    assert client.post(EXCHANGE, json={"code": body["code"]}).status_code == 403
