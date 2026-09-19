"""Board A37 time-of-day chips (DECISIONS §L, founder-delegated 2026-09-19): the
additive `available_times` beside the single-choice `availability`, validated, stored,
shown to the admin queue and carried into the approved mentor's availability note."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models.admin import AdminAccount
from app.models.enums import AdminRole
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.user import User
from app.security import issue_admin_token, issue_session_token
from app.services import categories, stream

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres

URL = "/api/v1/listener-applications"
BASE = {
    "motivation": "I sat the exam three times and know how lonely the second attempt gets.",
    "communities": ["upsc"],
    "availability": "few_hours",
    "email": None,
    "mentor_interest": False,
    "pledge_accepted": True,
}


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(stream, "ensure_user", lambda *a, **k: True)
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, listener_applications, "
                "admin_accounts, admin_audit_log CASCADE"
            )
        )
        s.commit()
    yield


@pytest.fixture
def admin_headers():
    with TestSession() as s:
        a = AdminAccount(name="Founder", role=AdminRole.owner)
        s.add(a)
        s.commit()
        admin_id = a.id
    return {"Authorization": f"Bearer {issue_admin_token(admin_id)}"}


def _member() -> dict[str, str]:
    with TestSession() as s:
        u = User(
            persona_name="Steady Cedar", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30
        )
        s.add(u)
        s.commit()
        uid = u.id
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _stored() -> ListenerApplication:
    with TestSession() as s:
        return s.query(ListenerApplication).one()


def test_times_are_stored_deduplicated_in_day_order(client):
    r = client.post(
        URL,
        json={**BASE, "available_times": ["weekends", "mornings", "weekends"]},
        headers=_member(),
    )
    assert r.status_code == 200, r.text
    assert _stored().available_times == ["mornings", "weekends"]


def test_an_unknown_time_is_a_422(client):
    r = client.post(URL, json={**BASE, "available_times": ["midnight"]}, headers=_member())
    assert r.status_code == 422


def test_the_three_board_chips_and_the_two_reserved_ones_are_accepted(client):
    times = ["mornings", "afternoons", "evenings", "late_nights", "weekends"]
    r = client.post(URL, json={**BASE, "available_times": times}, headers=_member())
    assert r.status_code == 200, r.text
    assert _stored().available_times == times


def test_an_older_build_without_the_field_still_submits(client):
    r = client.post(URL, json=BASE, headers=_member())
    assert r.status_code == 200, r.text
    assert _stored().available_times is None


def test_the_single_choice_commitment_is_still_required(client):
    body = {k: v for k, v in BASE.items() if k != "availability"}
    r = client.post(URL, json={**body, "available_times": ["mornings"]}, headers=_member())
    assert r.status_code == 422


def test_admin_queue_shows_the_times_and_approval_carries_them_into_the_note(client, admin_headers):
    client.post(URL, json={**BASE, "available_times": ["weekends", "mornings"]}, headers=_member())
    items = client.get("/api/v1/admin/applications?status=pending", headers=admin_headers).json()
    assert items[0]["available_times"] == ["mornings", "weekends"]
    assert items[0]["availability"] == "few_hours"

    ok = client.post(f"/api/v1/admin/applications/{items[0]['id']}/approve", headers=admin_headers)
    assert ok.status_code == 200, ok.text
    with TestSession() as s:
        li = s.query(ListenerProfile).one()
        # Member-facing: "usually here mornings and weekends" — nothing identifying.
        assert li.availability_note == "mornings and weekends"


def test_approval_without_times_falls_back_to_the_commitment(client, admin_headers):
    client.post(URL, json=BASE, headers=_member())
    items = client.get("/api/v1/admin/applications?status=pending", headers=admin_headers).json()
    assert items[0]["available_times"] == []
    client.post(f"/api/v1/admin/applications/{items[0]['id']}/approve", headers=admin_headers)
    with TestSession() as s:
        assert s.query(ListenerProfile).one().availability_note == "a few hours a week"


def test_note_wording_fits_the_profile_column():
    assert categories.availability_note(["evenings"], "varies") == "evenings"
    assert categories.availability_note(["weekends", "evenings", "mornings"], "varies") == (
        "mornings, evenings and weekends"
    )
    every = categories.availability_note(list(categories.AVAILABLE_TIMES), "few_hours")
    assert every == "mornings, afternoons, evenings, late nights and weekends"
    assert len(every) <= 60
    assert categories.availability_note([], "most_evenings") == "most evenings"
