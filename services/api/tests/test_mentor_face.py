"""One mentor, one face (services/mentor_face.py, lane u11).

A mentor is drawn as the same companion animal in the same wash on every screen, so the
server carries it on every mentor payload. Proves: it is dealt on insert and is stable
(same listener → same face on every call and across a name rotation); every member-facing
mentor payload and the mentor's own /listener/me carry it; the backfill migration deals
the same face as the app; nothing about the member (or the mentor's member side) rides
along; the mentor's console rows carry the member's companion + colour, never its name.
"""

from __future__ import annotations

import importlib.util
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.admin import AdminAccount
from app.models.conversation import Conversation
from app.models.enums import AdminRole, ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_admin_token, issue_listener_token, issue_session_token
from app.services import companions, mentor_face, mentor_names, stream

from .conftest import TestSession, requires_postgres

API = "/api/v1"
DAY1 = datetime(2026, 3, 1, 6, 0, tzinfo=UTC)  # 11:30 IST
DAY2 = DAY1 + timedelta(days=1)
PRIVATE_NAME = "Biscotti"


@pytest.fixture(autouse=True)
def _stub_stream(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )


@pytest.fixture
def client():
    return TestClient(app)


def _member(s, *, animal: str | None = "Cat", colour: str | None = "rose") -> str:
    u = User(
        persona_name="Gentle Harbor",
        persona_avatar="x",
        dob=date(1997, 1, 1),
        age_at_signup=29,
        companion_animal=animal,
        companion_colour=colour,
        companion_name=PRIVATE_NAME,
    )
    s.add(u)
    s.flush()
    return u.id


def _mentor(s, name: str = "Steady Cedar", **kw) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar=kw.pop("persona_avatar", "owl"),
        categories=["exam_stress"],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
        created_at=DAY1 - timedelta(days=30),
        **kw,
    )
    s.add(li)
    s.flush()
    return li.id


def _convo(s, member: str, mentor: str, status=ConversationStatus.active) -> str:
    c = Conversation(
        user_id=member,
        listener_id=mentor,
        status=status,
        stream_channel_id=f"ch-{uuid.uuid4().hex[:10]}",
        issue_category="exam_stress",
    )
    s.add(c)
    s.flush()
    return c.id


def _u(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def _l(listener_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_listener_token(listener_id)}"}


def _face(listener_id: str) -> tuple[str, str]:
    with TestSession() as s:
        li = s.get(ListenerProfile, listener_id)
        return li.companion_animal, li.companion_colour


# --- the deal ------------------------------------------------------------------------


def test_derive_is_deterministic_and_inside_the_drawable_sets():
    ids = [str(uuid.uuid4()) for _ in range(200)]
    for lid in ids:
        a, c = mentor_face.derive(lid)
        assert (a, c) == mentor_face.derive(lid)
        assert a in companions.ANIMALS
        assert c in companions.COLOURS
    # A real spread, not one animal for everybody.
    assert len({mentor_face.derive(lid)[0] for lid in ids}) >= 6


def test_the_backfill_migration_deals_the_same_face_as_the_app():
    path = next(
        (Path(__file__).resolve().parents[1] / "migrations" / "versions").glob("4b971bd4faaa_*.py")
    )
    spec = importlib.util.spec_from_file_location("mentor_face_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    for _ in range(100):
        lid = str(uuid.uuid4())
        assert module._derive(lid) == mentor_face.derive(lid)


def test_the_face_never_depends_on_the_name_or_the_avatar_seed():
    lid = str(uuid.uuid4())
    a = ListenerProfile(id=lid, persona_name="Steady Cedar", persona_avatar="owl")
    b = ListenerProfile(id=lid, persona_name="Quiet Banyan", persona_avatar="something-else")
    assert mentor_face.face(a) == mentor_face.face(b) == mentor_face.derive(lid)


@requires_postgres
def test_every_new_mentor_is_dealt_a_face_on_insert(db_session):
    lid = _mentor(db_session)
    db_session.commit()
    assert _face(lid) == mentor_face.derive(lid)


@requires_postgres
def test_an_explicit_face_is_kept(db_session):
    lid = _mentor(db_session, companion_animal="Owl", companion_colour="sage")
    db_session.commit()
    assert _face(lid) == ("Owl", "sage")


# --- every payload carries it --------------------------------------------------------


@requires_postgres
def test_every_member_facing_mentor_payload_carries_the_same_face(client, db_session):
    member = _member(db_session)
    cedar = _mentor(db_session)
    convo = _convo(db_session, member, cedar)
    db_session.commit()
    want = {"companion_animal": _face(cedar)[0], "companion_colour": _face(cedar)[1]}
    as_listener = {
        "listener_companion_animal": want["companion_animal"],
        "listener_companion_colour": want["companion_colour"],
    }

    browse = client.get(f"{API}/listeners", headers=_u(member)).json()
    card = next(i for i in browse if i["id"] == cedar)
    assert {k: card[k] for k in want} == want

    by_id = client.get(f"{API}/listeners/{cedar}", headers=_u(member)).json()
    assert {k: by_id[k] for k in want} == want

    header = client.get(f"{API}/conversations/{convo}/mentor", headers=_u(member)).json()
    assert {k: header[k] for k in want} == want

    rows = client.get(f"{API}/conversations", headers=_u(member)).json()
    assert {k: rows[0][k] for k in as_listener} == as_listener

    # Stay in touch: ask, the mentor says yes, the In touch view draws the same face.
    link_id = client.post(f"{API}/conversations/{convo}/stay-in-touch", headers=_u(member)).json()[
        "link_id"
    ]
    waiting = client.get(f"{API}/in-touch", headers=_u(member)).json()["waiting"]
    assert {k: waiting[0][k] for k in want} == want
    client.post(f"{API}/listener/me/stay-in-touch/{link_id}/accept", headers=_l(cedar))
    items = client.get(f"{API}/in-touch", headers=_u(member)).json()["items"]
    assert {k: items[0][k] for k in want} == want

    # A Personal request and the A04 letter's re-read.
    sent = client.post(
        f"{API}/listeners/{cedar}/request",
        json={"intro_message": "Could we talk this evening?"},
        headers=_u(member),
    ).json()
    assert {k: sent[k] for k in as_listener} == as_listener
    mine = client.get(f"{API}/listeners/requests/mine", headers=_u(member)).json()
    assert {k: mine[0][k] for k in as_listener} == as_listener

    # The mentor sees the SAME face for themselves on Mentor Home.
    me = client.get(f"{API}/listener/me", headers=_l(cedar)).json()
    assert {k: me[k] for k in want} == want


@requires_postgres
def test_the_match_result_carries_the_found_mentors_face(client, db_session):
    member = _member(db_session)
    cedar = _mentor(db_session)
    db_session.commit()
    r = client.post(f"{API}/match", json={"kind": "general"}, headers=_u(member))
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["listener_companion_animal"], body["listener_companion_colour"]) == _face(cedar)


# --- stability -----------------------------------------------------------------------


@requires_postgres
def test_the_face_survives_a_name_rotation(client, db_session, monkeypatch):
    monkeypatch.setattr(mentor_names, "ENABLED", True)
    monkeypatch.setattr(mentor_names, "_memo", None)
    clock = {"now": DAY1}
    monkeypatch.setattr(mentor_names, "_utcnow", lambda: clock["now"])
    member = _member(db_session)
    cedar = _mentor(db_session)
    convo = _convo(db_session, member, cedar)
    db_session.commit()

    def look() -> tuple[str, str, str]:
        body = client.get(f"{API}/conversations/{convo}/mentor", headers=_u(member)).json()
        return body["persona_name"], body["companion_animal"], body["companion_colour"]

    name1, animal1, colour1 = look()
    assert look() == (name1, animal1, colour1)  # same call, same face

    clock["now"] = DAY2
    mentor_names._memo = None
    name2, animal2, colour2 = look()
    assert name2 != name1  # the name rotated…
    assert (animal2, colour2) == (animal1, colour1)  # …the face did not
    me = client.get(f"{API}/listener/me", headers=_l(cedar)).json()
    assert (me["companion_animal"], me["companion_colour"]) == (animal1, colour1)


# --- privacy -------------------------------------------------------------------------


APPLY = {
    "motivation": "I've walked the UPSC road twice and know how lonely the wait gets.",
    "communities": ["upsc"],
    "availability": "most_evenings",
    "email": None,
    "mentor_interest": False,
    "pledge_accepted": True,
}


@requires_postgres
def test_approval_deals_a_face_from_the_listener_id_not_the_members_companion(client, db_session):
    """A member with a Cat applies and is approved: their mentor face comes from the new
    listener id — never their own member companion (that would tie their two sides
    together for anyone who met both)."""
    member = _member(db_session, animal="Cat", colour="rose")
    admin = AdminAccount(name="Founder", role=AdminRole.owner)
    db_session.add(admin)
    db_session.commit()
    admin_auth = {"Authorization": f"Bearer {issue_admin_token(admin.id)}"}
    assert client.post(
        f"{API}/listener-applications", json=APPLY, headers=_u(member)
    ).status_code in (200, 201)
    app_id = client.get(f"{API}/admin/applications?status=pending", headers=admin_auth).json()[0][
        "id"
    ]
    ok = client.post(f"{API}/admin/applications/{app_id}/approve", headers=admin_auth)
    assert ok.status_code == 200, ok.text
    with TestSession() as s:
        li = s.query(ListenerProfile).filter_by(vetting_status=VettingStatus.approved).one()
        assert (li.companion_animal, li.companion_colour) == mentor_face.derive(li.id)


@requires_postgres
def test_mentor_payloads_carry_nothing_about_the_member(client, db_session):
    member = _member(db_session, animal="Cat", colour="rose")
    cedar = _mentor(db_session)
    convo = _convo(db_session, member, cedar)
    db_session.commit()
    for path in (
        f"{API}/listeners",
        f"{API}/listeners/{cedar}",
        f"{API}/conversations",
        f"{API}/conversations/{convo}/mentor",
    ):
        r = client.get(path, headers=_u(member))
        assert r.status_code == 200, path
        assert PRIVATE_NAME not in r.text
        assert member not in r.text, f"{path} carries the member id"
    me = client.get(f"{API}/listener/me", headers=_l(cedar))
    assert member not in me.text and PRIVATE_NAME not in me.text


# --- the mentor's console rows (board A10) --------------------------------------------


@requires_postgres
def test_console_rows_carry_the_members_companion_but_never_its_name(client, db_session):
    member = _member(db_session, animal="Cat", colour="rose")
    cedar = _mentor(db_session)
    _convo(db_session, member, cedar)
    db_session.commit()
    client.post(
        f"{API}/listeners/{cedar}/request",
        json={"intro_message": "How did you plan revision?", "issue_category": "exam_stress"},
        headers=_u(member),
    )

    rows = client.get(f"{API}/listener/me/conversations", headers=_l(cedar))
    assert rows.status_code == 200
    row = rows.json()[0]
    assert (row["user_companion_animal"], row["user_companion_colour"]) == ("Cat", "rose")
    assert PRIVATE_NAME not in rows.text

    reqs = client.get(f"{API}/listener/me/requests", headers=_l(cedar))
    req = reqs.json()[0]
    assert (req["requester_companion_animal"], req["requester_companion_colour"]) == (
        "Cat",
        "rose",
    )
    assert req["issue_category_label"] == "Exam stress"
    assert PRIVATE_NAME not in reqs.text


@requires_postgres
def test_a_member_without_a_companion_reads_null_not_a_default(client, db_session):
    member = _member(db_session, animal=None, colour=None)
    cedar = _mentor(db_session)
    _convo(db_session, member, cedar)
    db_session.commit()
    row = client.get(f"{API}/listener/me/conversations", headers=_l(cedar)).json()[0]
    assert row["user_companion_animal"] is None and row["user_companion_colour"] is None
