"""Stay in touch (DECISIONS §L.6–7): consent both ways, two places, quiet "not now",
either side ends it, a block or report ends it, scoping, and no identity in any payload.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models.admin import AdminAccount
from app.models.conversation import Conversation
from app.models.enums import (
    AdminRole,
    ConversationStatus,
    LinkEndedBy,
    LinkStatus,
    ListenerStatus,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.mentor_link import MentorLink
from app.models.user import User
from app.security import issue_admin_token, issue_listener_token, issue_session_token

from .conftest import TestSession, requires_postgres

API = "/api/v1"
_PRIVATE_DOB = date(1997, 5, 17)
_PRIVATE_EMAIL = "someone@example.com"
_PRIVATE_NAME = "Private Clementine"


@pytest.fixture
def client():
    return TestClient(app)


def _member(s, name: str = "Gentle Harbor") -> str:
    u = User(
        persona_name=name,
        persona_avatar="harbor",
        dob=_PRIVATE_DOB,
        age_at_signup=29,
        email=_PRIVATE_EMAIL,
        companion_animal="Cat",
        companion_colour="sage",
    )
    s.add(u)
    s.flush()
    return u.id


def _mentor(s, name: str, **kw) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="owl",
        categories=["exam_stress"],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        public_line="I sat the exam three times.",
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
        ended_at=datetime.now(UTC) if status != ConversationStatus.active else None,
    )
    s.add(c)
    s.flush()
    return c.id


def _u(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def _l(listener_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_listener_token(listener_id)}"}


def _ask(client, convo: str, member: str):
    return client.post(f"{API}/conversations/{convo}/stay-in-touch", headers=_u(member))


def _accept(client, link_id: str, mentor: str):
    return client.post(f"{API}/listener/me/stay-in-touch/{link_id}/accept", headers=_l(mentor))


@pytest.fixture
def world(db_session):
    """One member, three mentors, a conversation with each."""
    s = db_session
    member = _member(s)
    mentors = [_mentor(s, n) for n in ("Steady Cedar", "Amber Monsoon", "Calm Peepal")]
    convos = [_convo(s, member, m) for m in mentors]
    s.commit()
    return member, mentors, convos


# --- consent both ways -----------------------------------------------------------


@requires_postgres
def test_ask_then_yes_puts_the_mentor_in_touch(client, world):
    member, (cedar, *_), (convo, *_) = world
    before = client.get(f"{API}/conversations/{convo}/stay-in-touch", headers=_u(member)).json()
    assert (before["state"], before["can_ask"], before["link_id"]) == ("none", True, None)
    assert before["slots"] == {"limit": 2, "in_touch": 0, "waiting": 0, "free": 2}
    assert before["mentor_name"] == "Steady Cedar"

    asked = _ask(client, convo, member)
    assert asked.status_code == 200
    body = asked.json()
    assert (body["state"], body["can_ask"]) == ("asked", False)
    assert body["slots"]["waiting"] == 1
    link_id = body["link_id"]

    # Asking is not being in touch: nothing shows in the In touch view yet.
    listing = client.get(f"{API}/in-touch", headers=_u(member)).json()
    assert listing["items"] == []
    assert [w["link_id"] for w in listing["waiting"]] == [link_id]

    # A second tap is the same ask, not a second row.
    assert _ask(client, convo, member).json()["link_id"] == link_id
    with TestSession() as s:
        assert len(s.scalars(select(MentorLink)).all()) == 1

    waiting = client.get(f"{API}/listener/me/stay-in-touch", headers=_l(cedar)).json()
    assert [w["id"] for w in waiting] == [link_id]
    assert waiting[0]["member_persona_name"] == "Gentle Harbor"
    assert waiting[0]["conversation_id"] == convo

    assert _accept(client, link_id, cedar).json() == {"status": "in_touch"}
    assert client.get(f"{API}/listener/me/stay-in-touch", headers=_l(cedar)).json() == []

    listing = client.get(f"{API}/in-touch", headers=_u(member)).json()
    assert listing["slots"] == {"limit": 2, "in_touch": 1, "waiting": 0, "free": 1}
    (item,) = listing["items"]
    assert (item["listener_id"], item["persona_name"], item["state"]) == (
        cedar,
        "Steady Cedar",
        "in_touch",
    )
    assert item["first_met_as"] is None  # same name still — nothing to add
    assert (item["conversation_id"], item["conversation_status"]) == (convo, "active")
    assert item["since"] is not None

    # The flags the other surfaces carry.
    chats = client.get(f"{API}/conversations", headers=_u(member)).json()
    assert {c["id"]: c["in_touch"] for c in chats}[convo] is True
    assert sum(c["in_touch"] for c in chats) == 1
    browse = client.get(f"{API}/listeners", headers=_u(member)).json()
    assert (browse[0]["id"], browse[0]["in_touch"]) == (cedar, True)  # in touch first
    assert all(not b["in_touch"] for b in browse[1:])
    mentor_view = client.get(f"{API}/conversations/{convo}/mentor", headers=_u(member)).json()
    assert mentor_view["in_touch"] is True
    assert mentor_view["stay_in_touch"]["state"] == "in_touch"
    mine = client.get(f"{API}/listener/me/conversations", headers=_l(cedar)).json()
    assert [c["in_touch"] for c in mine] == [True]
    brief = client.get(f"{API}/listener/me/conversations/{convo}/brief", headers=_l(cedar)).json()
    assert brief["in_touch"] is True


@requires_postgres
def test_accepting_never_takes_a_seat(client, world):
    member, (cedar, *_), (convo, *_) = world
    with TestSession() as s:
        li = s.get(ListenerProfile, cedar)
        li.active_conversations = li.max_concurrent  # at capacity
        s.commit()
    link_id = _ask(client, convo, member).json()["link_id"]
    assert _accept(client, link_id, cedar).status_code == 200
    with TestSession() as s:
        li = s.get(ListenerProfile, cedar)
        assert li.active_conversations == li.max_concurrent


@requires_postgres
def test_not_now_is_quiet_and_cannot_be_nagged(client, world):
    member, (cedar, *_), (convo, *_) = world
    link_id = _ask(client, convo, member).json()["link_id"]
    r = client.post(f"{API}/listener/me/stay-in-touch/{link_id}/not-now", headers=_l(cedar))
    assert r.json() == {"status": "not_now"}

    state = client.get(f"{API}/conversations/{convo}/stay-in-touch", headers=_u(member)).json()
    assert (state["state"], state["can_ask"]) == ("not_now", False)
    assert state["blocked_reason"] == "not_now_cooldown"
    assert state["slots"]["free"] == 2  # a "not now" holds no place
    again_at = datetime.fromisoformat(state["can_ask_again_at"])
    assert timedelta(days=6) < again_at - datetime.now(UTC) <= timedelta(days=7)

    refused = _ask(client, convo, member)
    assert refused.status_code == 409
    assert refused.json()["code"] == "not_now_cooldown"
    assert isinstance(refused.json()["detail"], str)  # the envelope old builds parse
    with TestSession() as s:
        link = s.get(MentorLink, link_id)
        assert link.status == LinkStatus.declined
        # nothing about a reason exists to store
        assert not any("reason" in c.name for c in MentorLink.__table__.columns)
        # …and once the pause has passed the member may ask again.
        link.responded_at = datetime.now(UTC) - timedelta(days=8)
        s.commit()
    assert _ask(client, convo, member).json()["state"] == "asked"


@requires_postgres
def test_take_it_back(client, world):
    member, (cedar, *_), (convo, *_) = world
    link_id = _ask(client, convo, member).json()["link_id"]
    r = client.delete(f"{API}/conversations/{convo}/stay-in-touch", headers=_u(member))
    assert (r.json()["state"], r.json()["can_ask"]) == ("none", True)
    assert client.get(f"{API}/listener/me/stay-in-touch", headers=_l(cedar)).json() == []
    assert _accept(client, link_id, cedar).status_code == 404  # nothing left to answer
    with TestSession() as s:
        link = s.get(MentorLink, link_id)
        assert (link.status, link.ended_by) == (LinkStatus.withdrawn, LinkEndedBy.member)
    # Taking back is not a decline: asking again is allowed straight away.
    assert _ask(client, convo, member).json()["state"] == "asked"
    # Idempotent: a DELETE with nothing live is still a 200.
    client.delete(f"{API}/conversations/{convo}/stay-in-touch", headers=_u(member))
    assert (
        client.delete(f"{API}/conversations/{convo}/stay-in-touch", headers=_u(member)).status_code
        == 200
    )


# --- the cap of two --------------------------------------------------------------


@requires_postgres
def test_the_third_ask_is_refused_with_the_true_reason(client, world):
    member, mentors, convos = world
    for mentor, convo in list(zip(mentors, convos, strict=True))[:2]:
        link_id = _ask(client, convo, member).json()["link_id"]
        assert _accept(client, link_id, mentor).status_code == 200

    third = _ask(client, convos[2], member)
    assert third.status_code == 409
    body = third.json()
    assert body["code"] == "in_touch_full"
    assert "two mentors at a time" in body["detail"]
    assert "protects their time" in body["detail"]
    for word in ("pay", "paid", "upgrade", "premium", "plan", "member", "subscri", "₹"):
        assert word not in body["detail"].lower()  # never hint at a paid tier (T&S #4)

    state = client.get(f"{API}/conversations/{convos[2]}/stay-in-touch", headers=_u(member)).json()
    assert (state["can_ask"], state["blocked_reason"]) == (False, "in_touch_full")
    assert state["slots"] == {"limit": 2, "in_touch": 2, "waiting": 0, "free": 0}

    # End one → room for someone new.
    first = client.get(f"{API}/in-touch", headers=_u(member)).json()["items"][0]
    ended = client.delete(f"{API}/in-touch/{first['link_id']}", headers=_u(member))
    assert ended.json() == {"status": "ended"}
    assert _ask(client, convos[2], member).status_code == 200


@requires_postgres
def test_a_waiting_ask_holds_a_place(client, world):
    """Otherwise a mentor's "yes" could be refused for room the member no longer has."""
    member, mentors, convos = world
    link = _ask(client, convos[0], member).json()["link_id"]
    _accept(client, link, mentors[0])
    waiting_link = _ask(client, convos[1], member).json()["link_id"]  # 1 in touch + 1 waiting

    third = _ask(client, convos[2], member)
    assert third.status_code == 409
    assert third.json()["code"] == "in_touch_waiting"

    assert _accept(client, waiting_link, mentors[1]).status_code == 200  # the yes always lands
    with TestSession() as s:
        accepted = s.scalars(
            select(MentorLink).where(
                MentorLink.user_id == member, MentorLink.status == LinkStatus.accepted
            )
        ).all()
    assert len(accepted) == 2


# --- either side can end it; safety ends it --------------------------------------


@requires_postgres
def test_the_mentor_can_end_it(client, world):
    member, (cedar, other, _), (convo, other_convo, _) = world
    link_id = _ask(client, convo, member).json()["link_id"]
    _accept(client, link_id, cedar)

    # Only through their OWN conversation.
    wrong = client.delete(
        f"{API}/listener/me/conversations/{other_convo}/stay-in-touch", headers=_l(cedar)
    )
    assert wrong.status_code == 404

    r = client.delete(f"{API}/listener/me/conversations/{convo}/stay-in-touch", headers=_l(cedar))
    assert r.json() == {"status": "ended"}
    with TestSession() as s:
        link = s.get(MentorLink, link_id)
        assert (link.status, link.ended_by) == (LinkStatus.ended, LinkEndedBy.listener)
    assert client.get(f"{API}/in-touch", headers=_u(member)).json()["items"] == []
    # Ending is not a decline: no cooldown, the member may ask again.
    assert _ask(client, convo, member).json()["state"] == "asked"


@requires_postgres
@pytest.mark.parametrize("action", ["block", "report"])
def test_a_block_or_report_ends_the_link(client, world, action):
    member, (cedar, *_), (convo, *_) = world
    link_id = _ask(client, convo, member).json()["link_id"]
    _accept(client, link_id, cedar)

    r = client.post(f"{API}/conversations/{convo}/{action}", json={}, headers=_u(member))
    assert r.status_code == 200
    with TestSession() as s:
        link = s.get(MentorLink, link_id)
        assert (link.status, link.ended_by) == (LinkStatus.ended, LinkEndedBy.system)
    assert client.get(f"{API}/in-touch", headers=_u(member)).json()["items"] == []
    if action == "block":
        refused = _ask(client, convo, member)
        assert (refused.status_code, refused.json()["code"]) == (409, "mentor_unavailable")


@requires_postgres
def test_a_block_ends_a_waiting_ask_too(client, world):
    member, (cedar, *_), (convo, *_) = world
    link_id = _ask(client, convo, member).json()["link_id"]
    client.post(f"{API}/conversations/{convo}/block", json={}, headers=_u(member))
    assert _accept(client, link_id, cedar).status_code == 404
    assert client.get(f"{API}/listener/me/stay-in-touch", headers=_l(cedar)).json() == []


@requires_postgres
def test_a_mentor_report_ends_the_link(client, world):
    member, (cedar, *_), (convo, *_) = world
    link_id = _ask(client, convo, member).json()["link_id"]
    _accept(client, link_id, cedar)
    r = client.post(
        f"{API}/listener/me/conversations/{convo}/report",
        json={"reason": "harassment"},
        headers=_l(cedar),
    )
    assert r.status_code == 200
    with TestSession() as s:
        assert s.get(MentorLink, link_id).status == LinkStatus.ended


@requires_postgres
def test_suspending_a_mentor_ends_their_links(client, world, db_session):
    member, (cedar, *_), (convo, *_) = world
    link_id = _ask(client, convo, member).json()["link_id"]
    _accept(client, link_id, cedar)
    admin = AdminAccount(name="Founder", role=AdminRole.owner)
    db_session.add(admin)
    db_session.commit()
    r = client.post(
        f"{API}/admin/listeners/{cedar}/suspend",
        headers={"Authorization": f"Bearer {issue_admin_token(admin.id)}"},
    )
    assert r.status_code == 200
    with TestSession() as s:
        link = s.get(MentorLink, link_id)
        assert (link.status, link.ended_by) == (LinkStatus.ended, LinkEndedBy.system)
    assert client.get(f"{API}/in-touch", headers=_u(member)).json()["slots"]["free"] == 2


# --- scoping ---------------------------------------------------------------------


@requires_postgres
def test_members_and_mentors_see_only_their_own(client, world, db_session):
    member, (cedar, monsoon, _), (convo, *_) = world
    stranger = _member(db_session, "Far Shore")
    stranger_convo = _convo(db_session, stranger, cedar)
    db_session.commit()
    link_id = _ask(client, convo, member).json()["link_id"]

    # Another member: cannot read, ask through, take back or end anything of mine.
    for method in ("get", "post", "delete"):
        r = getattr(client, method)(
            f"{API}/conversations/{convo}/stay-in-touch", headers=_u(stranger)
        )
        assert r.status_code == 404
    assert client.delete(f"{API}/in-touch/{link_id}", headers=_u(stranger)).status_code == 404
    listing = client.get(f"{API}/in-touch", headers=_u(stranger)).json()
    assert listing["items"] == [] and listing["waiting"] == []
    assert listing["slots"]["waiting"] == 0

    # Another mentor: does not see the ask and cannot answer it.
    assert client.get(f"{API}/listener/me/stay-in-touch", headers=_l(monsoon)).json() == []
    assert _accept(client, link_id, monsoon).status_code == 404
    r = client.post(f"{API}/listener/me/stay-in-touch/{link_id}/not-now", headers=_l(monsoon))
    assert r.status_code == 404
    with TestSession() as s:
        assert s.get(MentorLink, link_id).status == LinkStatus.pending

    # Roles never cross: a member token on the mentor routes and the reverse.
    assert client.get(f"{API}/listener/me/stay-in-touch", headers=_u(member)).status_code == 401
    assert client.get(f"{API}/in-touch", headers=_l(cedar)).status_code == 401
    assert _ask(client, stranger_convo, member).status_code == 404

    # A suspended mentor's token is dead here too.
    _accept(client, link_id, cedar)
    with TestSession() as s:
        s.get(ListenerProfile, cedar).vetting_status = VettingStatus.suspended
        s.commit()
    assert client.get(f"{API}/listener/me/stay-in-touch", headers=_l(cedar)).status_code == 403


def _assert_no_private_identity(payload):
    """Check JSON fields/values, rather than digits inside opaque identifiers."""
    private_fields = {
        "dob",
        "date_of_birth",
        "birthdate",
        "birthday",
        "birth_year",
        "age",
        "age_at_signup",
        "email",
        "email_address",
        "real_name",
        "full_name",
        "name",
        "companion_name",
    }
    if isinstance(payload, dict):
        assert not private_fields.intersection(key.casefold() for key in payload)
        for value in payload.values():
            _assert_no_private_identity(value)
    elif isinstance(payload, list):
        for value in payload:
            _assert_no_private_identity(value)
    elif isinstance(payload, str):
        for private in (_PRIVATE_EMAIL, _PRIVATE_NAME, _PRIVATE_DOB.isoformat()):
            assert private.casefold() not in payload.casefold()
        # A birth year as a standalone value is sensitive; UUID digits are not a date.
        assert payload != str(_PRIVATE_DOB.year)
    else:
        assert payload != _PRIVATE_DOB.year


def test_privacy_assertion_allows_year_digits_inside_uuid():
    _assert_no_private_identity(
        {
            "items": [
                {
                    "id": "3b879894-ee22-4f4b-ad4b-19979cce69cf",
                    "member_persona_name": "Gentle Harbor",
                }
            ]
        }
    )


@pytest.mark.parametrize(
    "leak",
    [
        {"dob": None},
        {"age_at_signup": 29},
        {"email": "different@example.com"},
        {"real_name": "Different Real Name"},
        {"companion_name": "Different Private Name"},
        {"public_line": f"Born {_PRIVATE_DOB.isoformat()}"},
        {"value": str(_PRIVATE_DOB.year)},
        {"value": _PRIVATE_DOB.year},
        {"public_line": f"Contact {_PRIVATE_EMAIL.upper()}"},
        {"member_persona_name": _PRIVATE_NAME},
        {"public_line": f"My name is {_PRIVATE_NAME.lower()}"},
    ],
)
def test_privacy_assertion_rejects_private_fields_and_values(leak):
    with pytest.raises(AssertionError):
        _assert_no_private_identity({"nested": [leak]})


@requires_postgres
def test_no_identity_in_any_payload(client, world):
    """Personas and companions only — never an id of the other person's account, an
    age, a date of birth or an email, in either direction (T&S #7)."""
    member, (cedar, *_), (convo, *_) = world
    with TestSession() as s:
        s.get(User, member).companion_name = _PRIVATE_NAME
        s.commit()
    link_id = _ask(client, convo, member).json()["link_id"]
    mentor_side = client.get(f"{API}/listener/me/stay-in-touch", headers=_l(cedar))
    assert set(mentor_side.json()[0]) == {
        "id",
        "member_persona_name",
        "member_persona_avatar",
        "companion_animal",
        "companion_colour",
        "conversation_id",
        "asked_at",
    }
    _accept(client, link_id, cedar)
    payloads = [
        mentor_side,
        client.get(f"{API}/listener/me/conversations", headers=_l(cedar)),
        client.get(f"{API}/in-touch", headers=_u(member)),
        client.get(f"{API}/conversations/{convo}/stay-in-touch", headers=_u(member)),
    ]
    for response in payloads:
        assert response.status_code == 200
        _assert_no_private_identity(response.json())
    # The mentor never receives the member's account id; the member already knows the
    # mentor's listener id from Browse, and nothing more.
    assert member not in payloads[0].text and member not in payloads[1].text


# --- favourites keep working (deprecated) ----------------------------------------


@requires_postgres
def test_deprecated_favourites_still_work_and_sort_after_in_touch(client, world):
    member, (cedar, monsoon, peepal), (convo, *_) = world
    assert (
        client.post(f"{API}/listeners/{peepal}/favourite", headers=_u(member)).json()["status"]
        == "favourited"
    )
    link_id = _ask(client, convo, member).json()["link_id"]
    _accept(client, link_id, cedar)
    browse = client.get(f"{API}/listeners", headers=_u(member)).json()
    assert [b["id"] for b in browse[:2]] == [cedar, peepal]
    assert browse[1]["is_favourite"] is True
    assert (
        client.delete(f"{API}/listeners/{peepal}/favourite", headers=_u(member)).status_code == 200
    )
    spec = client.get("/openapi.json").json()["paths"]
    assert spec[f"{API}/listeners/{{listener_id}}/favourite"]["post"]["deprecated"] is True
