"""Tiers, the two new-chat routes and the mentee profile (DECISIONS R.4-R.7, R.14)."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.main import app
from app.models.admin import AdminAccount, AdminAuditLog
from app.models.conversation import Conversation
from app.models.enums import AdminRole, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.mentee_profile import MenteeProfile
from app.models.safety import SafetyFlag
from app.models.user import User
from app.security import issue_admin_token, issue_listener_token, issue_session_token
from app.services import stream, tiers
from app.services.paths_data import COMMUNITIES

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture(autouse=True)
def _stream(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )
    monkeypatch.setattr(stream, "post_message", lambda *a, **k: None)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, conversations, conversation_requests, "
                "request_passes, mentee_profiles, safety_flags, admin_accounts, "
                "admin_audit_log CASCADE"
            )
        )
        s.commit()
    yield


def _member(s, community="upsc") -> str:
    u = User(
        persona_name="Quiet Cove",
        persona_avatar="x",
        dob=date(1996, 1, 1),
        age_at_signup=30,
        community_slug=community,
        journey_stage=next(iter(COMMUNITIES[community]["stages"])),
    )
    s.add(u)
    s.flush()
    return u.id


def _mentor(s, name, tier="listener", **kw) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="seed",
        categories=[],
        status=kw.pop("status", ListenerStatus.online),
        vetting_status=VettingStatus.approved,
        rank=kw.pop("rank", 10),
        active_conversations=0,
        max_concurrent=3,
        certified_exam=tier == "verified",
        tier="mentor" if tier == "mentor" else None,
        **kw,
    )
    s.add(li)
    s.flush()
    return li.id


def _auth(uid):
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _lauth(lid):
    return {"Authorization": f"Bearer {issue_listener_token(lid)}"}


def _partner(r) -> str:
    with TestSession() as s:
        return s.get(Conversation, r.json()["conversation_id"]).listener_id


def _inbox(client, lid):
    r = client.get("/api/v1/listener/me/requests", headers=_lauth(lid))
    assert r.status_code == 200, r.text
    return r.json()


# --- the rule itself ------------------------------------------------------------


@pytest.mark.parametrize(
    "audience,allowed",
    [
        ("any", {"listener", "mentor", "verified"}),
        ("in_service", {"verified"}),
        ("peer", {"listener", "mentor"}),
        ("listeners", {"listener", "mentor"}),
        ("mentorship", {"mentor", "verified"}),
        ("nonsense", {"listener", "mentor", "verified"}),
    ],
)
def test_who_may_take_each_audience(audience, allowed):
    assert {t for t in tiers.TIERS if tiers.audience_allows(audience, t)} == allowed


def test_tier_of_prefers_verified_then_mentor():
    assert tiers.tier_of(ListenerProfile(certified_exam=True, tier="mentor")) == "verified"
    assert tiers.tier_of(ListenerProfile(certified_exam=False, tier="mentor")) == "mentor"
    assert tiers.tier_of(ListenerProfile(certified_exam=False, tier=None)) == "listener"


# --- routing -------------------------------------------------------------------


def test_start_mentorship_reaches_mentors_and_verified_never_listeners(client):
    with TestSession() as s:
        member = _member(s)
        peer = _mentor(s, "Willow")
        mentor = _mentor(s, "Cedar", tier="mentor")
        verified = _mentor(s, "Maple", tier="verified")
        s.commit()
    r = client.post("/api/v1/match/ask", json={"audience": "mentorship"}, headers=_auth(member))
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    assert [x["id"] for x in _inbox(client, mentor)] == [rid]
    assert [x["id"] for x in _inbox(client, verified)] == [rid]
    assert _inbox(client, peer) == []
    refused = client.post(f"/api/v1/listener/me/requests/{rid}/accept", headers=_lauth(peer))
    assert refused.status_code == 404
    taken = client.post(f"/api/v1/listener/me/requests/{rid}/accept", headers=_lauth(mentor))
    assert taken.status_code == 200


def test_connect_now_never_picks_mento_verified(client):
    with TestSession() as s:
        member = _member(s, "life")
        _mentor(s, "Maple", tier="verified", rank=99)
        peer = _mentor(s, "Willow", rank=1)
        s.commit()
    r = client.post("/api/v1/match", json={"audience": "listeners"}, headers=_auth(member))
    assert r.status_code == 200, r.text
    assert _partner(r) == peer


def test_connect_now_with_only_verified_online_is_a_503(client):
    with TestSession() as s:
        member = _member(s, "life")
        _mentor(s, "Maple", tier="verified")
        s.commit()
    r = client.post("/api/v1/match", json={"audience": "listeners"}, headers=_auth(member))
    assert r.status_code == 503


def test_instant_match_without_audience_still_takes_anyone(client):
    with TestSession() as s:
        member = _member(s, "life")
        verified = _mentor(s, "Maple", tier="verified")
        s.commit()
    r = client.post("/api/v1/match", json={}, headers=_auth(member))
    assert r.status_code == 200 and _partner(r) == verified


def test_browse_cards_carry_tier_and_only_checked_badges(client):
    with TestSession() as s:
        member = _member(s)
        checked = _mentor(
            s,
            "Cedar",
            tier="mentor",
            exam_history={"prelims": 3, "mains": 2, "interview": 1},
        )
        s.get(ListenerProfile, checked).exam_history_checked_at = datetime.now(UTC)
        unchecked = _mentor(s, "Birch", tier="mentor", exam_history={"prelims": 1})
        s.commit()
    r = client.get("/api/v1/listeners", headers=_auth(member))
    assert r.status_code == 200, r.text
    cards = {c["id"]: c for c in r.json()}
    assert cards[checked]["tier"] == "mentor"
    assert cards[checked]["exam_badges"] == {"prelims": 3, "mains": 2, "interview": 1}
    assert cards[unchecked]["exam_badges"] is None


def test_browse_puts_online_mentors_first(client):
    with TestSession() as s:
        member = _member(s)
        away = _mentor(s, "Birch", status=ListenerStatus.offline, rank=99)
        here = _mentor(s, "Cedar", rank=1)
        s.commit()
    ids = [c["id"] for c in client.get("/api/v1/listeners", headers=_auth(member)).json()]
    assert ids.index(here) < ids.index(away)


# --- mentee profile ------------------------------------------------------------

PROFILE = {
    "exam": "upsc",
    "current_stage": "mains_prep",
    "attempts_count": 2,
    "furthest_stage": "mains",
    "optional_subject": "Sociology",
    "help_with": ["answer_writing", "strategy"],
    "note": "Mains answers run out of time.",
    "attempts": [
        {
            "year": 2024,
            "stage": "prelims",
            "prelims_gs": 88.5,
            "prelims_csat": 120,
            "mains_gs1": 99,
        },
        {"year": 2025, "stage": "mains", "prelims_gs": 104, "mains_gs1": 92, "interview": 150},
    ],
    "marks_visibility": "mentors",
}


def test_mentee_profile_round_trip_drops_marks_the_stage_never_reached(client):
    with TestSession() as s:
        member = _member(s)
        s.commit()
    assert client.get("/api/v1/me/mentee-profile", headers=_auth(member)).json()["exam"] is None
    r = client.put("/api/v1/me/mentee-profile", json=PROFILE, headers=_auth(member))
    assert r.status_code == 200, r.text
    got = client.get("/api/v1/me/mentee-profile", headers=_auth(member)).json()
    first, second = got["attempts"]
    assert first["mains_gs1"] is None  # prelims-only attempt: no Mains marks
    assert second["mains_gs1"] == 92 and second["interview"] is None  # no interview reached
    assert got["optional_subject"] == "Sociology" and got["updated_at"]


def test_marks_beyond_the_paper_maximum_are_refused(client):
    with TestSession() as s:
        member = _member(s)
        s.commit()
    bad = {"attempts": [{"year": 2025, "stage": "prelims", "prelims_gs": 201}]}
    r = client.put("/api/v1/me/mentee-profile", json=bad, headers=_auth(member))
    assert r.status_code == 422


@pytest.mark.parametrize(
    "visibility,peer_sees,mentor_sees",
    [("mentors", False, True), ("everyone", True, True), ("nobody", False, False)],
)
def test_the_inbox_brief_shows_marks_only_as_the_member_allowed(
    client, visibility, peer_sees, mentor_sees
):
    with TestSession() as s:
        member = _member(s)
        peer = _mentor(s, "Willow")
        mentor = _mentor(s, "Cedar", tier="mentor")
        s.commit()
    body = {**PROFILE, "marks_visibility": visibility}
    assert (
        client.put("/api/v1/me/mentee-profile", json=body, headers=_auth(member)).status_code == 200
    )
    assert client.post("/api/v1/match/ask", json={}, headers=_auth(member)).status_code == 200
    for lid, sees in ((peer, peer_sees), (mentor, mentor_sees)):
        (item,) = _inbox(client, lid)
        brief = item["mentee_brief"]
        assert brief["optional_subject"] == "Sociology"
        assert brief["marks_shown"] is sees
        assert (brief["attempts"][1]["mains_gs1"] == 92) is sees


def test_a_worrying_note_is_flagged_once_and_the_profile_still_saved(client):
    with TestSession() as s:
        member = _member(s)
        s.commit()
    body = {"note": "I want to kill myself if I fail again"}
    r = client.put("/api/v1/me/mentee-profile", json=body, headers=_auth(member))
    assert r.status_code == 200, r.text
    assert r.json()["support"]["helplines"]
    assert r.json()["note"] == body["note"]
    # Saving the same words again raises no second flag.
    again = client.put("/api/v1/me/mentee-profile", json=body, headers=_auth(member))
    assert again.json()["support"] is None
    with TestSession() as s:
        assert len(s.scalars(select(SafetyFlag).where(SafetyFlag.user_id == member)).all()) == 1


def test_deleting_the_mentee_profile_removes_the_row(client):
    with TestSession() as s:
        member = _member(s)
        s.commit()
    client.put("/api/v1/me/mentee-profile", json=PROFILE, headers=_auth(member))
    r = client.delete("/api/v1/me/mentee-profile", headers=_auth(member))
    assert r.status_code == 204
    with TestSession() as s:
        assert s.get(MenteeProfile, member) is None


# --- admin ---------------------------------------------------------------------


def _admin(s) -> dict:
    a = AdminAccount(name="Ops", role=AdminRole.owner)
    s.add(a)
    s.flush()
    return {"Authorization": f"Bearer {issue_admin_token(a.id)}"}


def test_admin_makes_a_listener_a_mentor_with_checked_badges(client):
    with TestSession() as s:
        admin = _admin(s)
        lid = _mentor(s, "Willow")
        s.commit()
    no_prelims = client.post(
        f"/api/v1/admin/listeners/{lid}/tier", json={"tier": "mentor"}, headers=admin
    )
    assert no_prelims.status_code == 422
    r = client.post(
        f"/api/v1/admin/listeners/{lid}/tier",
        json={"tier": "mentor", "prelims": 2, "mains": 1, "exam_history_checked": True},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    assert r.json()["tier"] == "mentor"
    with TestSession() as s:
        li = s.get(ListenerProfile, lid)
        assert li.tier == "mentor" and li.exam_history["prelims"] == 2
        assert li.exam_history_checked_at is not None
        log = s.scalars(
            select(AdminAuditLog).where(AdminAuditLog.action == "listener.tier_set")
        ).one()
        assert log.subject_id == lid
    listed = client.get("/api/v1/admin/listeners", headers=admin).json()
    row = next(x for x in listed if x["id"] == lid)
    assert row["tier"] == "mentor" and row["exam_history_checked"] is True


def test_browse_filters_by_type_gender_and_online(client):
    from app.models.enums import Gender

    with TestSession() as s:
        member = _member(s)
        peer = _mentor(s, "Willow", gender=Gender.female)
        mentor = _mentor(s, "Cedar", tier="mentor", gender=Gender.male)
        verified = _mentor(s, "Maple", tier="verified", status=ListenerStatus.offline)
        s.commit()

    def ids(**q):
        r = client.get("/api/v1/listeners", params=q, headers=_auth(member))
        assert r.status_code == 200, r.text
        return {c["id"] for c in r.json()}

    assert ids(tier="listener") == {peer}
    assert ids(tier="mentor") == {mentor}
    assert ids(tier="verified") == {verified}
    assert ids(gender="female") == {peer}
    assert ids(online="true") == {peer, mentor}
    assert ids() == {peer, mentor, verified}
