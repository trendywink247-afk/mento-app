"""Email confirmation (DECISIONS R.10): built, off until an email provider is set up."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import get_settings
from app.main import app
from app.models.email_confirmation import EmailConfirmation
from app.models.user import User
from app.security import issue_session_token
from app.services import email_confirm, email_sender

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(text("TRUNCATE users, email_confirmations CASCADE"))
        s.commit()
    yield


@pytest.fixture
def codes(monkeypatch):
    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(email_sender, "send_code", lambda to, code: sent.append((to, code)))
    return sent


def _member() -> str:
    with TestSession() as s:
        u = User(
            persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30
        )
        s.add(u)
        s.commit()
        return u.id


def _auth(uid):
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def test_status_is_off_by_default_and_with_the_log_provider(client, monkeypatch):
    uid = _member()
    r = client.get("/api/v1/me/email", headers=_auth(uid))
    assert r.json() == {"has_email": False, "verified": False, "required": False}
    monkeypatch.setattr(get_settings(), "email_required_from_second_visit", True)
    assert client.get("/api/v1/me/email", headers=_auth(uid)).json()["required"] is False
    monkeypatch.setattr(get_settings(), "email_provider", "smtp")
    assert client.get("/api/v1/me/email", headers=_auth(uid)).json()["required"] is True


def test_the_right_code_confirms_the_address(client, codes):
    uid = _member()
    r = client.post("/api/v1/me/email/start", json={"email": "A@Example.com"}, headers=_auth(uid))
    assert r.status_code == 200, r.text
    (to, code) = codes[-1]
    assert to == "a@example.com"
    with TestSession() as s:
        assert s.get(User, uid).email is None  # pending until confirmed
        assert code not in s.get(EmailConfirmation, uid).code_hash
    r = client.post("/api/v1/me/email/confirm", json={"code": code}, headers=_auth(uid))
    assert r.status_code == 200, r.text
    assert client.get("/api/v1/me/email", headers=_auth(uid)).json()["verified"] is True
    with TestSession() as s:
        assert s.get(User, uid).email == "a@example.com"
        assert s.get(EmailConfirmation, uid) is None


def test_five_wrong_codes_use_it_up(client, codes):
    uid = _member()
    client.post("/api/v1/me/email/start", json={"email": "a@example.com"}, headers=_auth(uid))
    good = codes[-1][1]
    bad = "000000" if good != "000000" else "111111"
    for _ in range(email_confirm.MAX_ATTEMPTS):
        r = client.post("/api/v1/me/email/confirm", json={"code": bad}, headers=_auth(uid))
        assert r.status_code == 400
    r = client.post("/api/v1/me/email/confirm", json={"code": good}, headers=_auth(uid))
    assert r.status_code == 400
    with TestSession() as s:
        assert s.get(User, uid).email_verified_at is None


def test_the_log_placeholder_accepts_and_sends_nothing(client):
    uid = _member()
    assert get_settings().email_provider == "log"
    r = client.post("/api/v1/me/email/start", json={"email": "a@example.com"}, headers=_auth(uid))
    assert r.status_code == 200  # the log placeholder "sends" (nothing leaves)


def test_a_real_provider_name_without_code_behind_it_is_a_503(client, monkeypatch):
    uid = _member()
    monkeypatch.setattr(get_settings(), "email_provider", "smtp")
    r = client.post("/api/v1/me/email/start", json={"email": "a@example.com"}, headers=_auth(uid))
    assert r.status_code == 503
    with TestSession() as s:
        assert s.get(EmailConfirmation, uid) is None


def test_erasing_the_member_removes_a_pending_confirmation(client, codes, monkeypatch):
    from app.services import stream

    monkeypatch.setattr(stream, "delete_user", lambda user_id: None)
    uid = _member()
    client.post("/api/v1/me/email/start", json={"email": "a@example.com"}, headers=_auth(uid))
    assert client.delete("/api/v1/me", headers=_auth(uid)).status_code == 200
    with TestSession() as s:
        assert s.get(EmailConfirmation, uid) is None
