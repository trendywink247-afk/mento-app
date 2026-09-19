"""Rotating mentor names (DECISIONS §L.6): daily at 04:00 IST, history stays coherent,
links survive and expose "first met as", a held name is never re-issued, and Stream
follows the rename.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, LinkStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.mentor_link import ListenerNameHistory, MentorLink
from app.models.user import User
from app.security import issue_listener_token, issue_session_token
from app.services import mentor_names, stream

from .conftest import TestSession, requires_postgres

API = "/api/v1"
DAY1 = datetime(2026, 3, 1, 6, 0, tzinfo=UTC)  # 11:30 IST
DAY2 = DAY1 + timedelta(days=1)
DAY3 = DAY1 + timedelta(days=2)


@pytest.fixture
def client():
    return TestClient(app)


class Clock:
    """The rotation pass's clock, for the passes the API's own dependency runs."""

    def __init__(self, monkeypatch) -> None:
        self.now = DAY1
        monkeypatch.setattr(mentor_names, "_utcnow", lambda: self.now)

    def set(self, now: datetime) -> None:
        self.now = now
        mentor_names._memo = None  # a new moment deserves a fresh look


@pytest.fixture
def rotating(monkeypatch) -> Clock:
    monkeypatch.setattr(mentor_names, "ENABLED", True)
    monkeypatch.setattr(mentor_names, "_memo", None)
    return Clock(monkeypatch)


def _member(s) -> str:
    u = User(
        persona_name="Gentle Harbor", persona_avatar="x", dob=date(1997, 1, 1), age_at_signup=29
    )
    s.add(u)
    s.flush()
    return u.id


def _mentor(s, name: str) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="owl",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        created_at=DAY1 - timedelta(days=30),
    )
    s.add(li)
    s.flush()
    return li.id


def _convo(s, member: str, mentor: str, *, created: datetime, ended: datetime | None = None) -> str:
    c = Conversation(
        user_id=member,
        listener_id=mentor,
        status=ConversationStatus.ended if ended else ConversationStatus.active,
        stream_channel_id=f"ch-{uuid.uuid4().hex[:10]}",
        created_at=created,
        ended_at=ended,
    )
    s.add(c)
    s.flush()
    return c.id


def _name(listener_id: str) -> str:
    with TestSession() as s:
        return s.get(ListenerProfile, listener_id).persona_name


def _pass(now: datetime) -> bool:
    with TestSession() as s:
        return mentor_names.ensure_fresh(s, now, force=True)


def _u(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


# --- the clock -------------------------------------------------------------------


def test_the_rotation_day_turns_at_four_in_the_morning_ist():
    before = datetime(2026, 3, 1, 22, 29, tzinfo=UTC)  # 03:59 IST on the 2nd
    after = datetime(2026, 3, 1, 22, 31, tzinfo=UTC)  # 04:01 IST on the 2nd
    assert mentor_names.rotation_day(before) == date(2026, 3, 1)
    assert mentor_names.rotation_day(after) == date(2026, 3, 2)
    assert mentor_names.next_rotation_at(before) == datetime(2026, 3, 1, 22, 30, tzinfo=UTC)
    assert mentor_names.next_rotation_at(after) == datetime(2026, 3, 2, 22, 30, tzinfo=UTC)


# --- the pass --------------------------------------------------------------------


@requires_postgres
def test_first_sight_stamps_without_renaming_then_rotates_daily(db_session, rotating):
    cedar = _mentor(db_session, "Steady Cedar")
    db_session.commit()

    _pass(DAY1)
    assert _name(cedar) == "Steady Cedar"  # a new mentor keeps their first name that day
    _pass(DAY1 + timedelta(hours=5))
    assert _name(cedar) == "Steady Cedar"  # same rotation day → nothing happens

    _pass(DAY2)
    second = _name(cedar)
    assert second != "Steady Cedar"
    _pass(DAY2 + timedelta(hours=3))
    assert _name(cedar) == second

    _pass(DAY3)
    third = _name(cedar)
    assert third not in ("Steady Cedar", second)

    with TestSession() as s:
        spans = s.scalars(
            select(ListenerNameHistory)
            .where(ListenerNameHistory.listener_id == cedar)
            .order_by(ListenerNameHistory.valid_from)
        ).all()
    assert [sp.persona_name for sp in spans] == ["Steady Cedar", second, third]
    assert [sp.valid_to for sp in spans[:2]] == [DAY2, DAY3]
    assert spans[2].valid_to is None


@requires_postgres
def test_rotation_is_off_by_default_in_tests_and_by_setting(db_session, monkeypatch):
    cedar = _mentor(db_session, "Steady Cedar")
    db_session.commit()
    assert _pass(DAY2) is False
    assert _name(cedar) == "Steady Cedar"


@requires_postgres
def test_names_never_collide_and_a_held_name_is_never_reissued(db_session, rotating, monkeypatch):
    """§L.7: a name a member still holds as "first met as" is not handed to anyone."""
    from app.services import persona

    member = _member(db_session)
    cedar = _mentor(db_session, "Steady Cedar")
    other = _mentor(db_session, "Amber Monsoon")
    db_session.add(
        MentorLink(
            user_id=member,
            listener_id=cedar,
            status=LinkStatus.accepted,
            first_met_as="Quiet Banyan",  # held, and nobody's current name
            first_met_at=DAY1,
        )
    )
    db_session.commit()
    _pass(DAY1)

    offered = iter(
        ["Quiet Banyan", "Amber Monsoon", "Steady Cedar", "Bright Meadow"]  # held, current ×2, free
        + ["Bright Meadow", "Soft Field"]  # taken a moment ago by the first mentor, free
    )
    monkeypatch.setattr(
        mentor_names, "generate_persona", lambda: persona.Persona(name=next(offered), avatar="x")
    )
    _pass(DAY2)
    assert sorted([_name(cedar), _name(other)]) == ["Bright Meadow", "Soft Field"]


@requires_postgres
def test_a_locked_mentor_row_is_skipped_not_waited_on(db_session, rotating):
    """The matcher holds listener rows FOR UPDATE; a rename must never queue behind it
    (nor make it wait)."""
    cedar = _mentor(db_session, "Steady Cedar")
    db_session.commit()
    _pass(DAY1)
    holder = TestSession()
    try:
        holder.execute(
            select(ListenerProfile).where(ListenerProfile.id == cedar).with_for_update()
        ).all()
        _pass(DAY2)  # returns at once
        assert _name(cedar) == "Steady Cedar"
    finally:
        holder.rollback()
        holder.close()
    _pass(DAY2)
    assert _name(cedar) != "Steady Cedar"  # the next pass gets it


@requires_postgres
def test_stream_follows_the_rename_and_a_failed_push_is_retried(db_session, rotating, monkeypatch):
    cedar = _mentor(db_session, "Steady Cedar")
    db_session.commit()
    _pass(DAY1)

    pushed: list[tuple[str, str]] = []
    monkeypatch.setattr(stream, "rename_user", lambda uid, name: False)  # Stream is down
    assert _pass(DAY2) is True  # "Stream has catching up to do"
    mentor_names.sync_stream_names()
    with TestSession() as s:
        assert s.get(ListenerProfile, cedar).persona_stream_synced is False

    monkeypatch.setattr(stream, "rename_user", lambda uid, name: pushed.append((uid, name)) or True)
    assert _pass(DAY2) is True  # same day, no rename — but still owed to Stream
    mentor_names.sync_stream_names()
    assert pushed == [(cedar, _name(cedar))]
    with TestSession() as s:
        assert s.get(ListenerProfile, cedar).persona_stream_synced is True
    assert _pass(DAY2) is False


# --- what the member sees --------------------------------------------------------


@requires_postgres
def test_history_stays_coherent_across_a_rename(client, db_session, rotating):
    """Active chat → today's name + "first talked as". Ended chat, not in touch → the
    name it ended under, and NOT today's. In touch → today's name + first met as."""
    member = _member(db_session)
    cedar = _mentor(db_session, "Steady Cedar")
    monsoon = _mentor(db_session, "Amber Monsoon")
    peepal = _mentor(db_session, "Calm Peepal")
    active = _convo(db_session, member, cedar, created=DAY1)
    ended = _convo(db_session, member, monsoon, created=DAY1, ended=DAY1 + timedelta(hours=2))
    linked = _convo(db_session, member, peepal, created=DAY1, ended=DAY1 + timedelta(hours=1))
    db_session.commit()
    _pass(DAY1)

    link_id = client.post(f"{API}/conversations/{linked}/stay-in-touch", headers=_u(member)).json()[
        "link_id"
    ]
    r = client.post(
        f"{API}/listener/me/stay-in-touch/{link_id}/accept",
        headers={"Authorization": f"Bearer {issue_listener_token(peepal)}"},
    )
    assert r.status_code == 200

    assert _name(peepal) == "Calm Peepal"  # asking and answering renamed nobody
    _pass(DAY2)
    day2_peepal = _name(peepal)
    _pass(DAY3)  # two renames: "first met" must still be the FIRST name
    rotating.set(DAY3 + timedelta(hours=1))
    new_cedar, new_monsoon, new_peepal = _name(cedar), _name(monsoon), _name(peepal)
    assert "Steady Cedar" != new_cedar and "Amber Monsoon" != new_monsoon
    assert len({"Calm Peepal", day2_peepal, new_peepal}) == 3

    chats = {c["id"]: c for c in client.get(f"{API}/conversations", headers=_u(member)).json()}
    assert chats[active]["listener_persona_name"] == new_cedar
    assert chats[active]["first_met_as"] == "Steady Cedar"
    assert chats[ended]["listener_persona_name"] == "Amber Monsoon"  # frozen
    assert chats[ended]["first_met_as"] is None
    assert new_monsoon not in str(chats[ended])  # tomorrow's name is not given away
    assert chats[linked]["listener_persona_name"] == new_peepal
    assert (chats[linked]["in_touch"], chats[linked]["first_met_as"]) == (True, "Calm Peepal")

    header = client.get(f"{API}/conversations/{active}/mentor", headers=_u(member)).json()
    assert (header["persona_name"], header["first_met_as"]) == (new_cedar, "Steady Cedar")
    old_raw = client.get(f"{API}/conversations/{ended}/mentor", headers=_u(member))
    old = old_raw.json()
    assert (old["persona_name"], old["first_met_as"]) == ("Amber Monsoon", None)
    assert old["stay_in_touch"]["mentor_name"] == "Amber Monsoon"  # the ask sheet too
    sheet = client.get(f"{API}/conversations/{ended}/stay-in-touch", headers=_u(member))
    assert new_monsoon not in old_raw.text and new_monsoon not in sheet.text

    (item,) = client.get(f"{API}/in-touch", headers=_u(member)).json()["items"]
    assert (item["persona_name"], item["first_met_as"]) == (new_peepal, "Calm Peepal")
    assert item["listener_id"] == peepal  # the link itself never moved

    browse = client.get(f"{API}/listeners", headers=_u(member)).json()
    assert (browse[0]["persona_name"], browse[0]["in_touch"]) == (new_peepal, True)
    assert browse[0]["first_met_as"] == "Calm Peepal"
    profile = client.get(f"{API}/listeners/{peepal}", headers=_u(member)).json()
    assert (profile["persona_name"], profile["first_met_as"]) == (new_peepal, "Calm Peepal")

    with TestSession() as s:
        link = s.get(MentorLink, link_id)
        assert (link.status, link.first_met_as) == (LinkStatus.accepted, "Calm Peepal")


@requires_postgres
def test_reading_browse_is_what_rotates_and_the_mentor_is_told_when(client, db_session, rotating):
    member = _member(db_session)
    cedar = _mentor(db_session, "Steady Cedar")
    db_session.get(ListenerProfile, cedar).persona_name_day = date(2020, 1, 1)  # long overdue
    db_session.commit()
    rotating.set(datetime.now(UTC))

    browse = client.get(f"{API}/listeners", headers=_u(member)).json()
    assert browse[0]["persona_name"] != "Steady Cedar"
    assert browse[0]["persona_name"] == _name(cedar)

    me = client.get(
        f"{API}/listener/me", headers={"Authorization": f"Bearer {issue_listener_token(cedar)}"}
    ).json()
    assert me["persona_name"] == _name(cedar)
    changes = datetime.fromisoformat(me["name_changes_at"])
    assert timedelta(0) < changes - datetime.now(UTC) <= timedelta(hours=24)
    assert changes.astimezone(mentor_names.IST).strftime("%H:%M") == "04:00"
