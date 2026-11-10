"""Mentor languages (founder, 2026-11-10): a preference that orders Browse, never a filter."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.enums import ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_session_token
from app.services import languages

from .conftest import TestSession, requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def test_clean_keeps_known_codes_once_in_order_and_caps_at_five():
    assert languages.clean(["HI", " en ", "xx", "hi", "ta", "te", "bn", "mr", "gu"]) == [
        "hi",
        "en",
        "ta",
        "te",
        "bn",
    ]
    assert languages.clean(None) == []


def _mentor(s, name, langs, rank=0):
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="x",
        categories=[],
        languages=langs,
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=rank,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


@requires_postgres
def test_browse_puts_the_asked_language_first_and_hides_nobody(client, db_session):
    with TestSession() as s:
        user = User(
            persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30
        )
        s.add(user)
        s.flush()
        uid = user.id
        english = _mentor(s, "Calm Harbor", ["en"], rank=9)
        hindi = _mentor(s, "Quiet Pine", ["hi", "en"], rank=0)
        unsaid = _mentor(s, "Soft Lantern", [], rank=5)
        s.commit()

    plain = client.get("/api/v1/listeners", headers=_auth(uid)).json()
    assert [m["id"] for m in plain][0] == english  # rank decides without a language

    asked = client.get("/api/v1/listeners?language=hi", headers=_auth(uid)).json()
    ids = [m["id"] for m in asked]
    assert ids[0] == hindi
    assert set(ids) == {english, hindi, unsaid}  # nobody is hidden
    assert asked[0]["languages"] == ["hi", "en"]
