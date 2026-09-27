"""T3.5 — the recovery code.

A member makes a code on Profile (shown ONCE). Only a lookup selector and an argon2id
hash of the rest are stored. Entering it on another device signs that device in as the
same member, revokes every refresh family they had, and starts a fresh one. Both the
issue and the redeem are rate-limited and FAIL CLOSED when Redis is down."""

from __future__ import annotations

import uuid
from datetime import date

import pytest
import redis as redis_lib
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import ratelimit
from app.main import app
from app.models.session import Session as AuthSession
from app.models.user import User
from app.security import issue_session_token
from app.services import recovery, stream

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres
API = "/api/v1"


@pytest.fixture(autouse=True)
def _stub_stream(monkeypatch):
    monkeypatch.setattr(stream, "user_token", lambda uid: f"stub::{uid}")


@pytest.fixture
def client():
    return TestClient(app)


def _member() -> str:
    with TestSession() as s:
        u = User(
            persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30
        )
        s.add(u)
        s.commit()
        return u.id


def _auth(uid: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _make(client, uid: str) -> str:
    r = client.post(f"{API}/me/recovery", headers=_auth(uid))
    assert r.status_code == 200, r.text
    return r.json()["phrase"]


def test_only_a_selector_and_an_argon2_hash_are_stored(client):
    uid = _member()
    phrase = _make(client, uid)
    assert len(phrase.replace("-", "")) == recovery.CODE_LENGTH
    with TestSession() as s:
        u = s.get(User, uid)
        assert u.recovery_hash.startswith("$argon2id$")
        compact = phrase.replace("-", "")
        assert compact not in (u.recovery_hash or "")
        assert u.recovery_selector == compact[: recovery.SELECTOR_LENGTH]
    assert client.get(f"{API}/me", headers=_auth(uid)).json()["has_recovery"] is True


def test_recovery_signs_in_as_the_same_member_and_revokes_old_sessions(client):
    uid = _member()
    old = client.post(f"{API}/auth/upgrade", headers=_auth(uid)).json()
    phrase = _make(client, uid)
    r = client.post(f"{API}/onboarding/recover", json={"phrase": phrase})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["id"] == uid
    assert body["refresh_token"] and body["stream_token"]
    access = {"Authorization": f"Bearer {body['session_token']}"}
    assert client.get(f"{API}/me", headers=access).json()["id"] == uid
    # the old family is dead…
    assert (
        client.post(f"{API}/auth/refresh", json={"refresh_token": old["refresh_token"]}).status_code
        == 401
    )
    # …the new one lives
    assert (
        client.post(
            f"{API}/auth/refresh", json={"refresh_token": body["refresh_token"]}
        ).status_code
        == 200
    )
    with TestSession() as s:
        live = s.scalars(
            select(AuthSession).where(AuthSession.user_id == uid, AuthSession.revoked_at.is_(None))
        ).all()
        assert len(live) == 1


def test_typing_is_forgiven_case_spaces_and_lookalikes(client):
    uid = _member()
    phrase = _make(client, uid)
    messy = " " + phrase.lower().replace("-", " ").replace("0", "o").replace("1", "l") + " "
    assert client.post(f"{API}/onboarding/recover", json={"phrase": messy}).status_code == 200


def test_wrong_or_unknown_codes_are_401(client):
    uid = _member()
    phrase = _make(client, uid)
    compact = phrase.replace("-", "")
    wrong_tail = compact[: recovery.SELECTOR_LENGTH] + ("2" if compact[-1] != "2" else "3") * (
        recovery.CODE_LENGTH - recovery.SELECTOR_LENGTH
    )
    assert client.post(f"{API}/onboarding/recover", json={"phrase": wrong_tail}).status_code == 401
    unknown = "Z" * recovery.CODE_LENGTH
    assert client.post(f"{API}/onboarding/recover", json={"phrase": unknown}).status_code == 401
    assert client.post(f"{API}/onboarding/recover", json={"phrase": "short"}).status_code == 401


def test_a_new_code_replaces_the_old_one(client):
    uid = _member()
    first = _make(client, uid)
    second = _make(client, uid)
    assert first != second
    assert client.post(f"{API}/onboarding/recover", json={"phrase": first}).status_code == 401
    assert client.post(f"{API}/onboarding/recover", json={"phrase": second}).status_code == 200


def test_recover_is_rate_limited(client, monkeypatch):
    monkeypatch.setattr(ratelimit, "client_ip", lambda request: f"rl-{uuid.uuid4()}")
    uid = _member()
    phrase = _make(client, uid)
    wrong = phrase.replace("-", "")[: recovery.SELECTOR_LENGTH] + "2" * (
        recovery.CODE_LENGTH - recovery.SELECTOR_LENGTH
    )
    ratelimit.ENABLED = True
    try:
        if not ratelimit.allow(f"probe:{uuid.uuid4()}", 1, 5):
            pytest.skip("Redis unavailable")
        codes = [
            client.post(f"{API}/onboarding/recover", json={"phrase": wrong}).status_code
            for _ in range(recovery.ATTEMPTS_PER_CODE + 1)
        ]
        assert codes[:-1] == [401] * recovery.ATTEMPTS_PER_CODE
        assert codes[-1] == 429
        # the right code is held back too, until the window passes
        assert client.post(f"{API}/onboarding/recover", json={"phrase": phrase}).status_code == 429
    finally:
        ratelimit.ENABLED = False


def test_recovery_fails_closed_without_redis(client, monkeypatch):
    uid = _member()
    phrase = _make(client, uid)

    class _Down:
        def pipeline(self):
            raise redis_lib.ConnectionError("down")

    monkeypatch.setattr(ratelimit, "_redis", lambda: _Down())
    ratelimit.ENABLED = True
    try:
        assert client.post(f"{API}/onboarding/recover", json={"phrase": phrase}).status_code == 503
        assert client.post(f"{API}/me/recovery", headers=_auth(uid)).status_code == 503
    finally:
        ratelimit.ENABLED = False


def test_erasure_takes_the_code_with_it(client, monkeypatch):
    monkeypatch.setattr(stream, "delete_user", lambda user_id: None)
    uid = _member()
    phrase = _make(client, uid)
    assert client.delete(f"{API}/me", headers=_auth(uid)).status_code == 200
    assert client.post(f"{API}/onboarding/recover", json={"phrase": phrase}).status_code == 401
