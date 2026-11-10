"""The crisis scan of a request's own words (founder, 2026-11-10): flagged, still sent, helpline card returned."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.main import app
from app.models.enums import ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.safety import SafetyFlag
from app.models.user import User
from app.security import issue_session_token
from app.services import paths_data, safety

from .conftest import TestSession


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    def wipe():
        with TestSession() as s:
            s.execute(
                text(
                    "TRUNCATE users, listener_profiles, conversations, conversation_requests, "
                    "request_passes, safety_flags CASCADE"
                )
            )
            s.commit()

    wipe()
    yield
    wipe()  # leave nothing behind for the next file


def _mentor(s):
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="r",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=0,
        active_conversations=0,
        max_concurrent=3,
        certified_exam=True,
    )
    s.add(li)
    s.flush()
    return li.id


def _member(s, road="upsc"):
    u = User(
        persona_name="Quiet Cove",
        persona_avatar="x",
        dob=date(1996, 1, 1),
        age_at_signup=30,
        community_slug=road,
        journey_stage=next(iter(paths_data.COMMUNITIES[road]["stages"])),
    )
    s.add(u)
    s.flush()
    return u.id


def _auth(uid):
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _flags(uid):
    with TestSession() as s:
        return s.scalars(select(SafetyFlag).where(SafetyFlag.user_id == uid)).all()


def test_a_question_that_trips_the_scan_is_flagged_still_sent_and_gets_the_helpline_card(client):
    with TestSession() as s:
        _mentor(s)
        uid = _member(s)
        s.commit()
    r = client.post(
        "/api/v1/match/ask", json={"intro_message": "I want to die"}, headers=_auth(uid)
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending" and body["intro_message"] == "I want to die"  # still sent
    assert body["support"]["message"] and body["support"]["helplines"]
    flags = _flags(uid)
    assert len(flags) == 1 and flags[0].conversation_id is None
    # signal only: the words themselves are never stored on the flag
    assert "die" not in (flags[0].matched_terms or "")


def test_an_ordinary_question_is_not_flagged_and_has_no_card(client):
    with TestSession() as s:
        _mentor(s)
        uid = _member(s)
        s.commit()
    r = client.post(
        "/api/v1/match/ask", json={"intro_message": "How do I plan my prelims?"}, headers=_auth(uid)
    )
    assert r.status_code == 200 and r.json()["support"] is None
    assert _flags(uid) == []


def test_the_stock_line_is_not_scanned_and_a_list_never_carries_the_card(client):
    with TestSession() as s:
        _mentor(s)
        uid = _member(s)
        s.commit()
    assert client.post("/api/v1/match/ask", json={}, headers=_auth(uid)).json()["support"] is None
    assert _flags(uid) == []
    mine = client.get("/api/v1/listeners/requests/mine", headers=_auth(uid)).json()
    assert all(x["support"] is None for x in mine)


def test_a_personal_request_is_scanned_too(client):
    with TestSession() as s:
        lid, uid = _mentor(s), _member(s, road="life")
        s.commit()
    r = client.post(
        f"/api/v1/listeners/{lid}/request",
        json={"intro_message": "I want to kill myself"},
        headers=_auth(uid),
    )
    assert r.status_code == 200, r.text
    assert r.json()["support"]["helplines"] and r.json()["intro_message"] == "I want to kill myself"
    assert len(_flags(uid)) == 1


def test_a_scan_fault_never_blocks_the_request(client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("scan down")

    monkeypatch.setattr(safety, "scan_and_flag", boom)
    with TestSession() as s:
        _mentor(s)
        uid = _member(s)
        s.commit()
    r = client.post(
        "/api/v1/match/ask", json={"intro_message": "I want to die"}, headers=_auth(uid)
    )
    assert r.status_code == 200 and r.json()["support"] is None  # fail-open: sent unscanned
