"""A mentor's name is never their member name (anonymity, founder 2026-11-15).

One person can be both a member and a mentor. Sharing a name would let anyone who met
"Quiet Cove" the member recognise "Quiet Cove" the mentor, so every new mentor profile gets
its own name and avatar seed, and older profiles that copied the member's are renamed once.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.main import app
from app.models.admin import AdminAccount
from app.models.enums import AdminRole, ApplicationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.mentor_link import ListenerNameHistory
from app.models.user import User
from app.security import issue_admin_token, issue_session_token
from app.services import mentor_invites, mentor_names, stream

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres

MEMBER = "Quiet Cove"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    calls: list[tuple] = []
    monkeypatch.setattr(stream, "ensure_user", lambda *a, **k: calls.append(a))
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, listener_applications, mentor_invites, "
                "listener_name_history, admin_accounts, admin_audit_log CASCADE"
            )
        )
        s.commit()
    yield calls


def _member(s) -> str:
    u = User(persona_name=MEMBER, persona_avatar="lake", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _admin(s) -> dict:
    a = AdminAccount(name="Founder", role=AdminRole.owner)
    s.add(a)
    s.flush()
    return {"Authorization": f"Bearer {issue_admin_token(a.id)}"}


def _profile(s, name: str) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="lake",
        categories=[],
        status=ListenerStatus.offline,
        vetting_status=VettingStatus.approved,
        rank=0,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def test_approving_an_application_gives_the_mentor_their_own_name(client, _clean):
    with TestSession() as s:
        uid, admin = _member(s), _admin(s)
        a = ListenerApplication(
            user_id=uid,
            motivation="I want to help.",
            communities=["upsc"],
            availability="few_hours_week",
            status=ApplicationStatus.pending,
            pledge_accepted_at=datetime.now(UTC),
        )
        s.add(a)
        s.commit()
        app_id = a.id
    r = client.post(f"/api/v1/admin/applications/{app_id}/approve", headers=admin)
    assert r.status_code == 200, r.text
    with TestSession() as s:
        li = s.get(ListenerProfile, s.get(ListenerApplication, app_id).listener_id)
        assert li.persona_name != MEMBER
    # The chat service is told the mentor's name, never the member's.
    assert _clean and all(MEMBER not in call for call in _clean)


def test_claiming_an_invitation_gives_the_mentor_their_own_name(client, _clean):
    with TestSession() as s:
        uid = _member(s)
        _, code = mentor_invites.create(s, note=None, admin_id=None)
        s.commit()
    r = client.post(
        "/api/v1/listener-applications/invite",
        json={"code": code, "pledge_accepted": True},
        headers={"Authorization": f"Bearer {issue_session_token(uid)}"},
    )
    assert r.status_code == 200, r.text
    with TestSession() as s:
        li = s.scalars(select(ListenerProfile)).one()
        assert li.persona_name != MEMBER and li.certified_exam is True
    assert _clean and all(MEMBER not in call for call in _clean)


def test_older_mentors_sharing_the_member_name_are_renamed_once():
    with TestSession() as s:
        uid = _member(s)
        shared = _profile(s, MEMBER)
        other_uid = User(
            persona_name="Bright Hill", persona_avatar="x", dob=date(1990, 1, 1), age_at_signup=35
        )
        s.add(other_uid)
        s.flush()
        kept = _profile(s, "Still River")  # applied as Bright Hill; already distinct
        for user_id, lid in ((uid, shared), (other_uid.id, kept)):
            s.add(
                ListenerApplication(
                    user_id=user_id,
                    motivation="x",
                    communities=["upsc"],
                    availability="few_hours_week",
                    status=ApplicationStatus.approved,
                    listener_id=lid,
                    pledge_accepted_at=datetime.now(UTC),
                )
            )
        seed = _profile(s, MEMBER)  # a seed mentor with no member behind it: not this rule
        s.commit()

    with TestSession() as s:
        assert mentor_names.separate_shared_names(s) == 1
    with TestSession() as s:
        li = s.get(ListenerProfile, shared)
        assert li.persona_name != MEMBER
        assert li.persona_stream_synced is False  # the chat service catches up
        spans = s.scalars(
            select(ListenerNameHistory)
            .where(ListenerNameHistory.listener_id == shared)
            .order_by(ListenerNameHistory.valid_from)
        ).all()
        assert [x.persona_name for x in spans] == [MEMBER, li.persona_name]
        assert spans[0].valid_to is not None and spans[1].valid_to is None
        assert s.get(ListenerProfile, kept).persona_name == "Still River"
        assert s.get(ListenerProfile, seed).persona_name == MEMBER
    with TestSession() as s:
        assert mentor_names.separate_shared_names(s) == 0  # idempotent


def test_a_new_identity_never_picks_the_member_name(monkeypatch):
    names = iter([MEMBER, MEMBER, "Calm Field"])

    class P:
        def __init__(self, n):
            self.name, self.avatar = n, "lake"

    monkeypatch.setattr(mentor_names, "generate_persona", lambda: P(next(names, "Calm Field")))
    with TestSession() as s:
        name, _ = mentor_names.new_mentor_identity(s, MEMBER)
        s.rollback()
    assert name == "Calm Field"
