"""Push-token registration — device-testing prerequisite, not a product feature yet."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models.push_token import PushToken
from app.models.user import User
from app.security import issue_session_token

from .conftest import TestSession, requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


def _seed_user(s) -> str:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


@requires_postgres
def test_register_token_creates_a_row_scoped_to_the_caller(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        s.commit()

    r = client.post(
        "/api/v1/notifications/register-token",
        json={"expo_push_token": "ExponentPushToken[abc123]", "platform": "android"},
        headers=_auth(uid),
    )
    assert r.status_code == 200 and r.json()["status"] == "registered"

    with TestSession() as s:
        row = s.scalars(
            select(PushToken).where(PushToken.expo_push_token == "ExponentPushToken[abc123]")
        ).one()
        assert row.user_id == uid
        assert row.platform == "android"


@requires_postgres
def test_reregistering_the_same_token_upserts_not_duplicates(client, db_session):
    with TestSession() as s:
        uid_a = _seed_user(s)
        uid_b = _seed_user(s)
        s.commit()

    token = "ExponentPushToken[shared-device]"
    client.post(
        "/api/v1/notifications/register-token",
        json={"expo_push_token": token, "platform": "android"},
        headers=_auth(uid_a),
    )
    # Same physical device, reinstalled under a new anonymous session — the row
    # should re-point to the new owner, not create a second one.
    r = client.post(
        "/api/v1/notifications/register-token",
        json={"expo_push_token": token, "platform": "ios"},
        headers=_auth(uid_b),
    )
    assert r.status_code == 200

    with TestSession() as s:
        rows = s.scalars(select(PushToken).where(PushToken.expo_push_token == token)).all()
        assert len(rows) == 1
        assert rows[0].user_id == uid_b
        assert rows[0].platform == "ios"


@requires_postgres
def test_invalid_platform_is_rejected(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        s.commit()

    r = client.post(
        "/api/v1/notifications/register-token",
        json={"expo_push_token": "ExponentPushToken[bad]", "platform": "windows"},
        headers=_auth(uid),
    )
    assert r.status_code == 422


@requires_postgres
def test_register_token_requires_auth(client, db_session):
    r = client.post(
        "/api/v1/notifications/register-token",
        json={"expo_push_token": "ExponentPushToken[noauth]", "platform": "android"},
    )
    assert r.status_code == 403  # HTTPBearer with no credentials
