"""PUT /listener/me/profile — the mentor's "Your line" editor (spec 2026-09-06
§3.3): length limits, whitespace/newline collapsing, empty → null, PATCH
semantics (an omitted field is left unchanged), suspension, and the rate limit
(live proof, same precedent as
test_security_hardening.py::test_pin_attempts_are_rate_limited)."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app import ratelimit
from app.main import app
from app.models.enums import ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.security import issue_listener_token

from .conftest import requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


def _seed_listener(s, *, vetting=VettingStatus.approved) -> str:
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=["loneliness"],
        status=ListenerStatus.online,
        vetting_status=vetting,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _auth(listener_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_listener_token(listener_id)}"}


@requires_postgres
def test_save_both_fields_reflects_on_me(client, db_session):
    lid = _seed_listener(db_session)
    db_session.commit()

    r = client.put(
        "/api/v1/listener/me/profile",
        json={"public_line": "I sat the exam three times.", "availability_note": "evenings"},
        headers=_auth(lid),
    )
    assert r.status_code == 200
    assert r.json()["public_line"] == "I sat the exam three times."
    assert r.json()["availability_note"] == "evenings"

    me = client.get("/api/v1/listener/me", headers=_auth(lid)).json()
    assert me["public_line"] == "I sat the exam three times."
    assert me["availability_note"] == "evenings"


@requires_postgres
def test_line_over_120_chars_is_422(client, db_session):
    lid = _seed_listener(db_session)
    db_session.commit()

    r = client.put(
        "/api/v1/listener/me/profile",
        json={"public_line": "a" * 121},
        headers=_auth(lid),
    )
    assert r.status_code == 422


@requires_postgres
def test_newlines_and_repeated_whitespace_are_collapsed(client, db_session):
    lid = _seed_listener(db_session)
    db_session.commit()

    r = client.put(
        "/api/v1/listener/me/profile",
        json={"public_line": "a\nb  c"},
        headers=_auth(lid),
    )
    assert r.status_code == 200
    assert r.json()["public_line"] == "a b c"


@requires_postgres
def test_empty_string_stores_null(client, db_session):
    lid = _seed_listener(db_session)
    db_session.commit()
    client.put(
        "/api/v1/listener/me/profile",
        json={"public_line": "something"},
        headers=_auth(lid),
    )

    r = client.put(
        "/api/v1/listener/me/profile",
        json={"public_line": ""},
        headers=_auth(lid),
    )
    assert r.status_code == 200
    assert r.json()["public_line"] is None


@requires_postgres
def test_omitted_field_is_unchanged(client, db_session):
    lid = _seed_listener(db_session)
    db_session.commit()
    client.put(
        "/api/v1/listener/me/profile",
        json={"public_line": "keep me", "availability_note": "weekends"},
        headers=_auth(lid),
    )

    r = client.put(
        "/api/v1/listener/me/profile",
        json={"availability_note": "evenings"},
        headers=_auth(lid),
    )
    assert r.status_code == 200
    assert r.json()["public_line"] == "keep me"  # untouched by the second call
    assert r.json()["availability_note"] == "evenings"


@requires_postgres
def test_suspended_listener_is_rejected(client, db_session):
    lid = _seed_listener(db_session, vetting=VettingStatus.suspended)
    db_session.commit()

    r = client.put(
        "/api/v1/listener/me/profile",
        json={"public_line": "hello"},
        headers=_auth(lid),
    )
    assert r.status_code == 403


@requires_postgres
def test_newlines_and_repeated_whitespace_are_collapsed_for_availability_note(client, db_session):
    lid = _seed_listener(db_session)
    db_session.commit()

    r = client.put(
        "/api/v1/listener/me/profile",
        json={"availability_note": "most\nevenings"},
        headers=_auth(lid),
    )
    assert r.status_code == 200
    assert r.json()["availability_note"] == "most evenings"


@requires_postgres
def test_rate_limit_is_enforced_on_the_listener_profile_key(client, db_session):
    """Live proof, not a call-recording stand-in — same idiom as
    test_security_hardening.py::test_pin_attempts_are_rate_limited: enable the
    real limiter around a key unique to this test run (a fresh listener id),
    skip if Redis is unreachable (the limiter fails open by design), and prove
    the 11th call in the 10/hour window is actually rejected."""
    lid = _seed_listener(db_session)
    db_session.commit()

    ratelimit.ENABLED = True
    try:
        if not ratelimit.allow(f"probe:{uuid.uuid4()}", 1, 5):
            pytest.skip("Redis unavailable — limiter fails open by design")
        statuses = [
            client.put(
                "/api/v1/listener/me/profile",
                json={"public_line": "hello"},
                headers=_auth(lid),
            ).status_code
            for _ in range(11)
        ]
        assert statuses[:10] == [200] * 10
        assert statuses[10] == 429
    finally:
        ratelimit.ENABLED = False
