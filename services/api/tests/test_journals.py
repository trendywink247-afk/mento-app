"""Save-to-Mentor-Notes — the chat→journal core loop (SCOPE §7) + note-sorting AI."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.enums import JournalChannel
from app.models.journal import JournalEntry
from app.models.user import User
from app.security import issue_session_token
from app.services import notes_ai

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
def test_save_and_list_mentor_note(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        s.commit()

    r = client.post(
        "/api/v1/journals/mentor-notes",
        json={
            "body": "Be kind to yourself first.",
            "conversation_id": "c-1",
            "listener_persona": "Open River",
            "stream_message_id": "m-1",
        },
        headers=_auth(uid),
    )
    assert r.status_code == 200
    note = r.json()
    assert note["channel"] == "mentor_notes" and note["source"] == "chat"
    assert note["meta"]["listener_persona"] == "Open River"

    r = client.get("/api/v1/journals/mentor-notes", headers=_auth(uid))
    assert r.status_code == 200
    assert [n["body"] for n in r.json()] == ["Be kind to yourself first."]


@requires_postgres
def test_saving_same_message_twice_is_idempotent(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        s.commit()

    payload = {"body": "One step at a time.", "stream_message_id": "m-dup"}
    first = client.post("/api/v1/journals/mentor-notes", json=payload, headers=_auth(uid))
    second = client.post("/api/v1/journals/mentor-notes", json=payload, headers=_auth(uid))
    assert first.json()["id"] == second.json()["id"]

    notes = client.get("/api/v1/journals/mentor-notes", headers=_auth(uid)).json()
    assert len(notes) == 1


@requires_postgres
def test_manual_entries_and_summary(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        s.commit()

    r = client.post(
        "/api/v1/journals/entries",
        json={"channel": "mood", "body": "Felt lighter after talking.", "meta": {"mood": "Calm"}},
        headers=_auth(uid),
    )
    assert r.status_code == 200 and r.json()["channel"] == "mood"
    client.post(
        "/api/v1/journals/entries",
        json={"channel": "finance", "body": "Chai", "meta": {"amount_paise": 2000, "direction": "expense"}},
        headers=_auth(uid),
    )

    moods = client.get("/api/v1/journals/entries?channel=mood", headers=_auth(uid)).json()
    assert [m["body"] for m in moods] == ["Felt lighter after talking."]

    summary = client.get("/api/v1/journals/summary", headers=_auth(uid)).json()
    assert summary == {"mood": 1, "finance": 1}

    # Mentor notes keep their idempotent endpoint; unknown channels are rejected.
    assert (
        client.post(
            "/api/v1/journals/entries",
            json={"channel": "mentor_notes", "body": "nope"},
            headers=_auth(uid),
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/v1/journals/entries",
            json={"channel": "bogus", "body": "nope"},
            headers=_auth(uid),
        ).status_code
        == 422
    )


@requires_postgres
def test_notes_are_scoped_to_the_owner(client, db_session):
    with TestSession() as s:
        uid_a = _seed_user(s)
        uid_b = _seed_user(s)
        s.commit()

    client.post(
        "/api/v1/journals/mentor-notes",
        json={"body": "Private to A."},
        headers=_auth(uid_a),
    )
    assert client.get("/api/v1/journals/mentor-notes", headers=_auth(uid_b)).json() == []


# --- note-sorting AI (opt-in, dark by default) ---


def _seed_mood_entries(uid: str, n: int) -> None:
    with TestSession() as s:
        for i in range(n):
            s.add(
                JournalEntry(
                    user_id=uid, channel=JournalChannel.mood, body=f"felt something {i}", source="manual"
                )
            )
        s.commit()


@requires_postgres
def test_organize_is_dark_by_default(client, db_session):
    # No Gemini key configured → the feature is off (503), nothing is sent anywhere.
    with TestSession() as s:
        uid = _seed_user(s)
        s.commit()
    r = client.post("/api/v1/journals/organize", json={"channel": "mood"}, headers=_auth(uid))
    assert r.status_code == 503


@requires_postgres
def test_organize_never_touches_mentor_notes(client, db_session, monkeypatch):
    # Even enabled, mentor_notes (the other party's words) can never be organized.
    monkeypatch.setattr(notes_ai, "is_enabled", lambda: True)
    with TestSession() as s:
        uid = _seed_user(s)
        s.commit()
    r = client.post(
        "/api/v1/journals/organize", json={"channel": "mentor_notes"}, headers=_auth(uid)
    )
    assert r.status_code == 400


@requires_postgres
def test_organize_needs_a_couple_of_entries(client, db_session, monkeypatch):
    monkeypatch.setattr(notes_ai, "is_enabled", lambda: True)
    with TestSession() as s:
        uid = _seed_user(s)
        s.commit()
    _seed_mood_entries(uid, 1)
    r = client.post("/api/v1/journals/organize", json={"channel": "mood"}, headers=_auth(uid))
    assert r.status_code == 400


@requires_postgres
def test_organize_returns_themes_when_enabled(client, db_session, monkeypatch):
    monkeypatch.setattr(notes_ai, "is_enabled", lambda: True)
    monkeypatch.setattr(
        notes_ai,
        "organize",
        lambda bodies: notes_ai.OrganizeResult(
            overview="You've been reflecting a lot.",
            themes=[notes_ai.Theme(title="Exam stress", summary="Worry about results.", count=2)],
        ),
    )
    with TestSession() as s:
        uid = _seed_user(s)
        s.commit()
    _seed_mood_entries(uid, 3)
    r = client.post("/api/v1/journals/organize", json={"channel": "mood"}, headers=_auth(uid))
    assert r.status_code == 200
    out = r.json()
    assert out["entry_count"] == 3
    assert out["themes"][0]["title"] == "Exam stress"
    assert out["overview"]
