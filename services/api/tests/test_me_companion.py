"""The member's own account: read it, and change the companion on an EXISTING account.

A member who started as a mentor and later switches to talking picks a companion that
used to be saved only on the device — the mentor's brief then showed nothing. One
allowed set (services/companions.py) serves onboarding and this endpoint.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_listener_token, issue_session_token
from app.services import companions, stream

from .conftest import TestSession, requires_postgres

ME = "/api/v1/me"
COMPANION = "/api/v1/me/companion"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _no_stream(monkeypatch):
    monkeypatch.setattr(stream, "upsert_user", lambda *a, **k: None)
    monkeypatch.setattr(stream, "user_token", lambda user_id: "stream-token")


def _user(s, **kwargs) -> str:
    u = User(
        persona_name="Gentle Harbor",
        persona_avatar="harbor",
        dob=date(1996, 1, 1),
        age_at_signup=30,
        email="keep@private.example",
        **kwargs,
    )
    s.add(u)
    s.flush()
    return u.id


def _auth(uid: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def test_the_nine_shipped_animals_and_seven_colours_are_the_allowed_set():
    assert set(companions.ANIMALS) == {
        "Panda",
        "Dog",
        "Cat",
        "Fox",
        "Capybara",
        "Elephant",
        "Turtle",
        "Deer",
        "Owl",
    }
    assert set(companions.COLOURS) == {
        "terracotta",
        "sage",
        "sky",
        "rose",
        "mustard",
        "plum",
        "teal",
    }


@requires_postgres
@pytest.mark.parametrize("animal", ["Dog", "Cat", "Capybara"])
def test_onboarding_accepts_the_three_new_animals(client, db_session, animal):
    r = client.post(
        "/api/v1/onboarding/start",
        json={"dob": "1996-01-01", "companion_animal": animal, "companion_colour": "sage"},
    )
    assert r.status_code == 201
    with TestSession() as s:
        user = s.get(User, r.json()["user"]["id"])
        assert (user.companion_animal, user.companion_colour) == (animal, "sage")


@requires_postgres
def test_onboarding_never_rejects_an_unknown_companion_it_stores_nothing(client, db_session):
    """An old build with a retired colour name must still get in — a 422 here would
    lock a person out of support. Unknown values are dropped, legacy casing is fixed."""
    r = client.post(
        "/api/v1/onboarding/start",
        json={
            "dob": "1996-01-01",
            "companion_animal": "panda",
            "companion_colour": "<script>lavender",
        },
    )
    assert r.status_code == 201
    with TestSession() as s:
        user = s.get(User, r.json()["user"]["id"])
        assert user.companion_animal == "Panda"
        assert user.companion_colour is None


@requires_postgres
def test_me_returns_persona_and_companion_and_nothing_private(client, db_session):
    with TestSession() as s:
        uid = _user(s, companion_animal="Cat", companion_colour="plum")
        s.commit()
    r = client.get(ME, headers=_auth(uid))
    assert r.status_code == 200
    assert r.json() == {
        "id": uid,
        "persona_name": "Gentle Harbor",
        "persona_avatar": "harbor",
        "companion_animal": "Cat",
        "companion_colour": "plum",
        "has_dob": True,
        "member_setup_complete": True,
        "companion_name": None,
        # The member's own standing (T3.7) — theirs to read, never anyone else's.
        "status": "active",
        "status_until": None,
    }


@requires_postgres
def test_member_setup_is_incomplete_until_a_companion_is_on_the_account(client, db_session):
    """A mentor who never picked a companion: "I'd rather talk today" must ask for it (and
    only it — the age gate was passed at sign-up). Never the DOB itself."""
    with TestSession() as s:
        uid = _user(s)
        s.commit()
    body = client.get(ME, headers=_auth(uid)).json()
    assert body["has_dob"] is True and body["member_setup_complete"] is False
    assert "dob" not in body and "age_at_signup" not in body
    client.put(f"{ME}/companion", json={"companion_animal": "Owl"}, headers=_auth(uid))
    assert client.get(ME, headers=_auth(uid)).json()["member_setup_complete"] is True


@requires_postgres
def test_companion_is_saved_on_an_existing_account(client, db_session):
    with TestSession() as s:
        uid = _user(s)  # a mentor-first member: no companion yet
        s.commit()
    r = client.put(
        COMPANION,
        json={"companion_animal": "Capybara", "companion_colour": "teal"},
        headers=_auth(uid),
    )
    assert r.status_code == 200
    assert (r.json()["companion_animal"], r.json()["companion_colour"]) == ("Capybara", "teal")
    with TestSession() as s:
        user = s.get(User, uid)
        assert (user.companion_animal, user.companion_colour) == ("Capybara", "teal")


@requires_postgres
def test_omitted_fields_are_left_alone_and_null_clears(client, db_session):
    with TestSession() as s:
        uid = _user(s, companion_animal="Owl", companion_colour="rose")
        s.commit()
    only_colour = client.put(COMPANION, json={"companion_colour": "sky"}, headers=_auth(uid))
    assert only_colour.status_code == 200
    assert only_colour.json()["companion_animal"] == "Owl"
    assert only_colour.json()["companion_colour"] == "sky"
    cleared = client.put(COMPANION, json={"companion_animal": None}, headers=_auth(uid))
    assert cleared.json()["companion_animal"] is None
    assert cleared.json()["companion_colour"] == "sky"


@requires_postgres
@pytest.mark.parametrize(
    "body",
    [
        {"companion_animal": "Dragon"},
        {"companion_colour": "lavender"},
        {"companion_animal": "x" * 40},
        {},
    ],
)
def test_unknown_values_and_empty_bodies_are_422_and_change_nothing(client, db_session, body):
    with TestSession() as s:
        uid = _user(s, companion_animal="Fox", companion_colour="sage")
        s.commit()
    assert client.put(COMPANION, json=body, headers=_auth(uid)).status_code == 422
    with TestSession() as s:
        user = s.get(User, uid)
        assert (user.companion_animal, user.companion_colour) == ("Fox", "sage")


@requires_postgres
def test_only_a_member_session_for_an_existing_user(client, db_session):
    with TestSession() as s:
        li = ListenerProfile(persona_name="Steady Cedar", persona_avatar="cedar", categories=[])
        s.add(li)
        s.commit()
        listener_token = issue_listener_token(li.id)
    body = {"companion_animal": "Dog"}
    assert client.put(COMPANION, json=body).status_code in (401, 403)
    as_listener = client.put(
        COMPANION, json=body, headers={"Authorization": f"Bearer {listener_token}"}
    )
    assert as_listener.status_code == 401
    assert client.put(COMPANION, json=body, headers=_auth("no-such-user")).status_code == 401
    assert client.get(ME, headers=_auth("no-such-user")).status_code == 401
