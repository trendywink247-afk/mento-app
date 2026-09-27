"""T3.2 — sessions and refresh tokens.

Access tokens live 15 minutes; refresh tokens rotate on every use, are stored only as
a hash, and a reused (already-rotated) refresh token kills its whole family (theft).
Clients that predate refresh keep their long-lived session token and keep working —
POST /auth/upgrade swaps it for a pair without a new sign-in."""

from __future__ import annotations

import hashlib
from datetime import UTC, date, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import security
from app.config import get_settings
from app.main import app
from app.models.session import Session as AuthSession
from app.models.user import User
from app.security import issue_session_token
from app.services import stream

from .conftest import TestSession, requires_postgres

API = "/api/v1"


@pytest.fixture(autouse=True)
def _stub_stream(monkeypatch):
    monkeypatch.setattr(stream, "upsert_user", lambda *a, **k: None)
    monkeypatch.setattr(stream, "user_token", lambda user_id: f"stub::{user_id}")


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


@pytest.fixture
def member_headers():
    return {"Authorization": f"Bearer {issue_session_token(_member())}"}


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@requires_postgres
def test_reused_refresh_token_kills_the_family(client, member_headers):
    first = client.post(f"{API}/auth/upgrade", headers=member_headers).json()
    rotated = client.post(
        f"{API}/auth/refresh", json={"refresh_token": first["refresh_token"]}
    ).json()
    assert rotated["refresh_token"] != first["refresh_token"]
    # presenting the OLD refresh token again is theft: everything in the family dies
    again = client.post(f"{API}/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert again.status_code == 401
    after = client.post(f"{API}/auth/refresh", json={"refresh_token": rotated["refresh_token"]})
    assert after.status_code == 401


@requires_postgres
def test_upgrade_returns_a_short_access_token_that_works(client, member_headers):
    pair = client.post(f"{API}/auth/upgrade", headers=member_headers).json()
    claims = jwt.decode(pair["access_token"], options={"verify_signature": False})
    assert claims["exp"] - claims["iat"] == 15 * 60
    assert claims["sid"]
    assert pair["expires_in"] == 15 * 60
    assert client.get(f"{API}/me", headers=_bearer(pair["access_token"])).status_code == 200


@requires_postgres
def test_refresh_tokens_are_stored_hashed(client, member_headers):
    pair = client.post(f"{API}/auth/upgrade", headers=member_headers).json()
    raw = pair["refresh_token"]
    with TestSession() as s:
        rows = s.scalars(select(AuthSession)).all()
        assert all(raw not in (r.token_hash, r.jti, r.id) for r in rows)
        assert hashlib.sha256(raw.encode()).hexdigest() in {r.token_hash for r in rows}


@requires_postgres
def test_rotation_chains_rows_in_one_family(client, member_headers):
    first = client.post(f"{API}/auth/upgrade", headers=member_headers).json()
    second = client.post(
        f"{API}/auth/refresh", json={"refresh_token": first["refresh_token"]}
    ).json()
    third = client.post(
        f"{API}/auth/refresh", json={"refresh_token": second["refresh_token"]}
    ).json()
    assert client.get(f"{API}/me", headers=_bearer(third["access_token"])).status_code == 200
    sid = jwt.decode(third["access_token"], options={"verify_signature": False})["sid"]
    with TestSession() as s:
        rows = s.scalars(select(AuthSession).where(AuthSession.family_id == sid)).all()
        assert len(rows) == 3
        live = [r for r in rows if r.revoked_at is None]
        assert len(live) == 1 and live[0].rotated_from is not None


@requires_postgres
def test_unknown_or_expired_refresh_is_401(client, member_headers):
    assert client.post(f"{API}/auth/refresh", json={"refresh_token": "mr1.nope"}).status_code == 401
    pair = client.post(f"{API}/auth/upgrade", headers=member_headers).json()
    with TestSession() as s:
        for row in s.scalars(select(AuthSession)).all():
            row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        s.commit()
    assert (
        client.post(
            f"{API}/auth/refresh", json={"refresh_token": pair["refresh_token"]}
        ).status_code
        == 401
    )


@requires_postgres
def test_expired_access_token_is_401_and_refresh_recovers(client, member_headers, monkeypatch):
    pair = client.post(f"{API}/auth/upgrade", headers=member_headers).json()
    later = datetime.now(UTC) + timedelta(minutes=16)
    real_decode = jwt.decode

    def _late_decode(*a, **k):  # PyJWT reads the wall clock; move it past the 15 minutes
        k.setdefault("leeway", 0)
        k["leeway"] = -int((later - datetime.now(UTC)).total_seconds())
        return real_decode(*a, **k)

    monkeypatch.setattr(security.jwt, "decode", _late_decode)
    assert client.get(f"{API}/me", headers=_bearer(pair["access_token"])).status_code == 401
    monkeypatch.setattr(security.jwt, "decode", real_decode)
    fresh = client.post(f"{API}/auth/refresh", json={"refresh_token": pair["refresh_token"]})
    assert fresh.status_code == 200
    assert client.get(f"{API}/me", headers=_bearer(fresh.json()["access_token"])).status_code == 200


@requires_postgres
def test_a_90_day_old_client_still_works_and_upgrades_silently(client):
    """The accept line: an install that onboarded ~89 days ago holds a claim-less,
    long-lived token. It still reaches every endpoint, and upgrade swaps it."""
    uid = _member()
    now = datetime.now(UTC)
    legacy = jwt.encode(
        {
            "sub": uid,
            "role": "user",
            "iat": int((now - timedelta(days=89)).timestamp()),
            "exp": int((now + timedelta(days=1)).timestamp()),
        },
        get_settings().jwt_secret,
        algorithm="HS256",
    )
    assert client.get(f"{API}/me", headers=_bearer(legacy)).status_code == 200
    pair = client.post(f"{API}/auth/upgrade", headers=_bearer(legacy))
    assert pair.status_code == 200
    assert client.get(f"{API}/me", headers=_bearer(pair.json()["access_token"])).status_code == 200
    # the old token is not revoked by upgrading — an interrupted upgrade can't log anyone out
    assert client.get(f"{API}/me", headers=_bearer(legacy)).status_code == 200


@requires_postgres
def test_upgrade_refuses_an_access_token(client, member_headers):
    pair = client.post(f"{API}/auth/upgrade", headers=member_headers).json()
    again = client.post(f"{API}/auth/upgrade", headers=_bearer(pair["access_token"]))
    assert again.status_code == 409
    assert again.json()["code"] == "already_upgraded"


@requires_postgres
def test_upgrade_needs_a_member_that_exists(client):
    ghost = {
        "Authorization": f"Bearer {issue_session_token('00000000-0000-0000-0000-000000000000')}"
    }
    assert client.post(f"{API}/auth/upgrade", headers=ghost).status_code == 401


@requires_postgres
def test_onboarding_opt_in_returns_a_pair_and_old_clients_get_the_old_shape(client):
    dob = (datetime.now(UTC).date() - timedelta(days=25 * 366)).isoformat()
    old = client.post(f"{API}/onboarding/start", json={"dob": dob}).json()
    assert old.get("refresh_token") is None
    claims = jwt.decode(old["session_token"], options={"verify_signature": False})
    assert claims["exp"] - claims["iat"] == get_settings().jwt_ttl_days * 86400
    assert "sid" not in claims

    new = client.post(f"{API}/onboarding/start", json={"dob": dob, "refresh": True}).json()
    assert new["refresh_token"]
    claims = jwt.decode(new["session_token"], options={"verify_signature": False})
    assert claims["exp"] - claims["iat"] == 15 * 60
    rotated = client.post(f"{API}/auth/refresh", json={"refresh_token": new["refresh_token"]})
    assert rotated.status_code == 200


@requires_postgres
def test_erasing_the_member_removes_their_sessions(client, member_headers, monkeypatch):
    monkeypatch.setattr(stream, "delete_user", lambda user_id: None, raising=False)
    pair = client.post(f"{API}/auth/upgrade", headers=member_headers).json()
    uid = jwt.decode(pair["access_token"], options={"verify_signature": False})["sub"]
    assert client.delete(f"{API}/me", headers=_bearer(pair["access_token"])).status_code == 200
    with TestSession() as s:
        assert s.scalars(select(AuthSession).where(AuthSession.user_id == uid)).all() == []
    assert (
        client.post(
            f"{API}/auth/refresh", json={"refresh_token": pair["refresh_token"]}
        ).status_code
        == 401
    )
