"""Rate-limit coverage (audit F9): the endpoints that cost money, a mentor's attention
or a safety reviewer's time each have a per-member window. Keys are per user id, and
every test mints a fresh user, so windows never couple runs through Redis."""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import ratelimit
from app.main import app
from app.models.enums import ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.safety import SafetyFlag
from app.models.user import User
from app.security import issue_session_token
from app.services import notes_ai

from .conftest import TestSession, requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def limiter_on():
    ratelimit.ENABLED = True
    try:
        if not ratelimit.allow(f"probe:{uuid.uuid4()}", 1, 5):
            pytest.skip("Redis unavailable — limiter fails open by design")
        yield
    finally:
        ratelimit.ENABLED = False


def _user(s) -> str:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _auth(uid: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


@requires_postgres
def test_self_scan_cannot_flood_the_safety_review_queue(client, db_session, limiter_on):
    with TestSession() as s:
        uid = _user(s)
        s.commit()
    statuses = [
        client.post(
            "/api/v1/safety/scan", json={"text": "I want to die"}, headers=_auth(uid)
        ).status_code
        for _ in range(32)
    ]
    assert statuses[:30] == [200] * 30
    assert statuses[30:] == [429, 429]
    with TestSession() as s:
        assert s.query(SafetyFlag).filter_by(user_id=uid).count() == 30


@requires_postgres
def test_note_sorting_is_capped_per_member(client, db_session, limiter_on, monkeypatch):
    calls: list[int] = []
    monkeypatch.setattr(notes_ai, "is_enabled", lambda: True)
    monkeypatch.setattr(
        notes_ai,
        "organize",
        lambda bodies: calls.append(1) or notes_ai.OrganizeResult(overview="ok"),
    )
    with TestSession() as s:
        uid = _user(s)
        s.commit()
    for body in ("a calm day", "a harder day"):
        created = client.post(
            "/api/v1/journals/entries", json={"channel": "mood", "body": body}, headers=_auth(uid)
        )
        assert created.status_code == 200
    statuses = [
        client.post(
            "/api/v1/journals/organize", json={"channel": "mood"}, headers=_auth(uid)
        ).status_code
        for _ in range(6)
    ]
    assert statuses == [200] * 5 + [429]
    assert len(calls) == 5  # the 6th never reached the paid model


@requires_postgres
def test_personal_requests_are_capped_per_member(client, db_session, limiter_on):
    with TestSession() as s:
        uid = _user(s)
        listener_ids = []
        for i in range(11):
            li = ListenerProfile(
                persona_name=f"Open River {i}",
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
            listener_ids.append(li.id)
        s.commit()
    statuses = []
    for lid in listener_ids:
        r = client.post(
            f"/api/v1/listeners/{lid}/request", json={"intro_message": "hello"}, headers=_auth(uid)
        )
        statuses.append(r.status_code)
        if r.status_code == 200:
            # One open question at a time: close it so the next ask meets the limiter,
            # not the question_open rule. Closing is never rate-limited.
            client.delete(f"/api/v1/listeners/requests/{r.json()['id']}", headers=_auth(uid))
    assert statuses == [200] * 10 + [429]


@requires_postgres
def test_journal_writes_are_capped_per_member(client, db_session, limiter_on, monkeypatch):
    from app.routers import journals

    monkeypatch.setattr(journals, "JOURNAL_WRITES_PER_HOUR", 3)
    with TestSession() as s:
        uid = _user(s)
        s.commit()
    statuses = [
        client.post(
            "/api/v1/journals/entries",
            json={"channel": "gratitude", "body": f"entry {i}"},
            headers=_auth(uid),
        ).status_code
        for i in range(3)
    ]
    # Mentor Notes share the same budget — it is one journal.
    statuses.append(
        client.post(
            "/api/v1/journals/mentor-notes", json={"body": "kept"}, headers=_auth(uid)
        ).status_code
    )
    assert statuses == [200, 200, 200, 429]
