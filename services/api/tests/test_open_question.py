"""One open question at a time (services/open_question.py): a Personal question still
waiting on a stranger holds back "Next available" and a Personal request to another
mentor with a calm 409 `question_open`; the member can close their own question; an
in-touch mentor, a recently crisis-flagged member and an unreachable target are never
held; and the rule is scoped to the member who asked.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.enums import (
    LinkStatus,
    ListenerStatus,
    RequestStatus,
    SafetySignal,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.mentor_link import MentorLink
from app.models.moderation import ModerationEvent
from app.models.request import ConversationRequest
from app.models.safety import SafetyFlag
from app.models.user import User
from app.security import issue_session_token
from app.services import stream

from .conftest import TestSession, requires_postgres

API = "/api/v1"


@pytest.fixture(autouse=True)
def _stub_stream(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )


@pytest.fixture
def client():
    return TestClient(app)


def _member(s, name: str = "Quiet Cove") -> str:
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _mentor(s, name: str, **kw) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="owl",
        categories=["exam_stress"],
        status=ListenerStatus.online,
        vetting_status=kw.pop("vetting_status", VettingStatus.approved),
        rank=kw.pop("rank", 10),
        **kw,
    )
    s.add(li)
    s.flush()
    return li.id


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def _ask(client, member: str, mentor: str, text: str = "I keep freezing in mocks."):
    return client.post(
        f"{API}/listeners/{mentor}/request",
        json={"intro_message": text},
        headers=_auth(member),
    )


def _match(client, member: str):
    return client.post(f"{API}/match", json={"kind": "general"}, headers=_auth(member))


@requires_postgres
def test_an_open_question_holds_back_next_available(client, db_session):
    with TestSession() as s:
        member = _member(s)
        waiting_on = _mentor(s, "Steady Cedar", rank=1)
        _mentor(s, "Open River", rank=50)  # free, would match
        s.commit()

    asked = _ask(client, member, waiting_on)
    assert asked.status_code == 200, asked.text

    r = _match(client, member)
    assert r.status_code == 409
    body = r.json()
    assert body["code"] == "question_open"
    assert body["mentor_name"] == "Steady Cedar"
    assert body["listener_id"] == waiting_on
    assert body["request_id"] == asked.json()["id"]
    assert "Steady Cedar" in body["detail"]
    assert "close it" in body["detail"]
    # One mentor, one face: the refusal names the waiting mentor's stable animal + wash,
    # the same pair every other payload carries for them.
    from app.services import mentor_face

    with TestSession() as s:
        expected = mentor_face.face(s.get(ListenerProfile, waiting_on))
    assert (body["mentor_companion_animal"], body["mentor_companion_colour"]) == expected


@requires_postgres
def test_an_open_question_holds_back_a_request_to_another_mentor(client, db_session):
    with TestSession() as s:
        member = _member(s)
        first = _mentor(s, "Steady Cedar")
        second = _mentor(s, "Bright Meadow")
        s.commit()

    assert _ask(client, member, first).status_code == 200
    r = _ask(client, member, second, "Another question")
    assert r.status_code == 409
    assert r.json()["code"] == "question_open"
    assert r.json()["mentor_name"] == "Steady Cedar"
    with TestSession() as s:
        assert (
            s.query(ConversationRequest)
            .filter(ConversationRequest.target_listener_id == second)
            .count()
            == 0
        )


@requires_postgres
def test_the_same_mentor_stays_idempotent(client, db_session):
    with TestSession() as s:
        member = _member(s)
        mentor = _mentor(s, "Steady Cedar")
        s.commit()
    a = _ask(client, member, mentor)
    b = _ask(client, member, mentor, "said again")
    assert a.status_code == b.status_code == 200
    assert a.json()["id"] == b.json()["id"]


@requires_postgres
def test_closing_the_question_frees_the_member(client, db_session):
    with TestSession() as s:
        member = _member(s)
        first = _mentor(s, "Steady Cedar", rank=1)
        _mentor(s, "Open River", rank=50)
        s.commit()

    req = _ask(client, member, first).json()
    assert _match(client, member).status_code == 409

    closed = client.delete(f"{API}/listeners/requests/{req['id']}", headers=_auth(member))
    assert closed.status_code == 200
    assert closed.json()["status"] == "expired"
    # idempotent
    again = client.delete(f"{API}/listeners/requests/{req['id']}", headers=_auth(member))
    assert again.status_code == 200 and again.json()["status"] == "expired"

    r = _match(client, member)
    assert r.status_code == 200, r.text


@requires_postgres
def test_closing_never_undoes_an_answer(client, db_session):
    with TestSession() as s:
        member = _member(s)
        mentor = _mentor(s, "Steady Cedar")
        s.commit()
    req = _ask(client, member, mentor).json()
    with TestSession() as s:
        row = s.get(ConversationRequest, req["id"])
        row.status = RequestStatus.matched
        s.commit()
    r = client.delete(f"{API}/listeners/requests/{req['id']}", headers=_auth(member))
    assert r.status_code == 200
    assert r.json()["status"] == "matched"


@requires_postgres
def test_only_the_asker_can_close_a_question(client, db_session):
    with TestSession() as s:
        member = _member(s)
        stranger = _member(s, "Other Person")
        mentor = _mentor(s, "Steady Cedar")
        s.commit()
    req = _ask(client, member, mentor).json()
    r = client.delete(f"{API}/listeners/requests/{req['id']}", headers=_auth(stranger))
    assert r.status_code == 404
    missing = client.delete(f"{API}/listeners/requests/nope", headers=_auth(member))
    assert missing.status_code == 404
    with TestSession() as s:
        assert s.get(ConversationRequest, req["id"]).status == RequestStatus.pending


@requires_postgres
def test_the_rule_is_scoped_to_the_member_who_asked(client, db_session):
    with TestSession() as s:
        member = _member(s)
        someone_else = _member(s, "Other Person")
        first = _mentor(s, "Steady Cedar", rank=1)
        second = _mentor(s, "Open River", rank=50)
        s.commit()
    assert _ask(client, member, first).status_code == 200
    # Another member is untouched by this member's open question — both paths.
    assert _ask(client, someone_else, second).status_code == 200
    with TestSession() as s:
        other = _member(s, "Third Person")
        s.commit()
    assert _match(client, other).status_code == 200


@requires_postgres
def test_an_in_touch_mentor_is_always_reachable(client, db_session):
    with TestSession() as s:
        member = _member(s)
        stranger = _mentor(s, "Steady Cedar")
        linked = _mentor(s, "Quiet Banyan")
        s.add(
            MentorLink(
                user_id=member,
                listener_id=linked,
                status=LinkStatus.accepted,
                first_met_as="Quiet Banyan",
                first_met_at=datetime.now(UTC),
                responded_at=datetime.now(UTC),
            )
        )
        s.commit()

    assert _ask(client, member, stranger).status_code == 200
    # Writing to the in-touch mentor while a stranger's question waits: allowed (§L.7).
    r = _ask(client, member, linked, "Can we talk again?")
    assert r.status_code == 200, r.text


@requires_postgres
def test_a_question_waiting_on_an_in_touch_mentor_is_not_an_open_question(client, db_session):
    with TestSession() as s:
        member = _member(s)
        linked = _mentor(s, "Quiet Banyan", rank=1)
        _mentor(s, "Open River", rank=50)
        s.add(
            MentorLink(
                user_id=member,
                listener_id=linked,
                status=LinkStatus.accepted,
                first_met_as="Quiet Banyan",
                first_met_at=datetime.now(UTC),
                responded_at=datetime.now(UTC),
            )
        )
        s.commit()
    assert _ask(client, member, linked).status_code == 200
    assert _match(client, member).status_code == 200


@requires_postgres
def test_the_crisis_path_is_never_held_by_the_rule(client, db_session):
    with TestSession() as s:
        member = _member(s)
        first = _mentor(s, "Steady Cedar", rank=1)
        second = _mentor(s, "Bright Meadow", rank=5)
        _mentor(s, "Open River", rank=50)
        s.commit()
    assert _ask(client, member, first).status_code == 200
    assert _match(client, member).status_code == 409

    with TestSession() as s:
        s.add(SafetyFlag(user_id=member, signal=SafetySignal.suicidal, matched_terms="x"))
        s.commit()

    # A member the scan flagged is never rationed: they reach the next person, and may
    # ask another mentor too.
    assert _match(client, member).status_code == 200
    assert _ask(client, member, second, "Please").status_code == 200


@requires_postgres
def test_an_old_crisis_flag_does_not_lift_the_rule(client, db_session):
    with TestSession() as s:
        member = _member(s)
        first = _mentor(s, "Steady Cedar", rank=1)
        _mentor(s, "Open River", rank=50)
        flag = SafetyFlag(user_id=member, signal=SafetySignal.suicidal)
        flag.created_at = datetime.now(UTC) - timedelta(days=3)
        s.add(flag)
        # A flag with no signal never counts either.
        s.add(SafetyFlag(user_id=member, signal=SafetySignal.none))
        s.commit()
    assert _ask(client, member, first).status_code == 200
    assert _match(client, member).status_code == 409


@requires_postgres
def test_an_unreachable_target_does_not_hold_the_member(client, db_session):
    with TestSession() as s:
        member = _member(s)
        suspended = _mentor(s, "Steady Cedar", rank=1)
        blocked = _mentor(s, "Bright Meadow", rank=2)
        _mentor(s, "Open River", rank=50)
        s.commit()
    assert _ask(client, member, suspended).status_code == 200
    with TestSession() as s:
        s.get(ListenerProfile, suspended).vetting_status = VettingStatus.suspended
        s.commit()
    assert _match(client, member).status_code == 200

    with TestSession() as s:
        m2 = _member(s, "Second Member")
        s.commit()
    assert _ask(client, m2, blocked).status_code == 200
    with TestSession() as s:
        s.add(ModerationEvent(reporter_id=m2, subject_id=blocked, blocked=True))
        s.commit()
    assert _match(client, m2).status_code == 200


@requires_postgres
def test_an_answered_question_frees_the_member(client, db_session):
    with TestSession() as s:
        member = _member(s)
        first = _mentor(s, "Steady Cedar", rank=1)
        _mentor(s, "Open River", rank=50)
        s.commit()
    req = _ask(client, member, first).json()
    with TestSession() as s:
        s.get(ConversationRequest, req["id"]).status = RequestStatus.declined
        s.commit()
    assert _match(client, member).status_code == 200
