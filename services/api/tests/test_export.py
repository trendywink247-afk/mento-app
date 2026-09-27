"""T2.5: GET /me/export — one JSON of the member's own rows.

The inventory is erasure's (services/erasure.py): whatever Start fresh deletes as the
member's, the export hands back first. What it never contains: another member's rows,
chat message text (it lives on Stream, not here), a mentor's internal id, secrets
(PIN hash, push token value) or the team's private notes (decline reason), and the
safety records held ABOUT the member for other people's protection.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.allowance import MessageAllowanceDay
from app.models.contribution import Contribution
from app.models.conversation import Conversation
from app.models.enums import (
    ApplicationStatus,
    JournalChannel,
    ListenerStatus,
    PushOwnerKind,
    ReporterKind,
    SafetySignal,
    VettingStatus,
)
from app.models.favourite import FavouriteListener
from app.models.journal import JournalEntry
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.mentor_link import MentorLink
from app.models.moderation import ModerationEvent
from app.models.push_token import PushToken
from app.models.reflection import ConversationReflection
from app.models.request import ConversationRequest
from app.models.safety import SafetyFlag
from app.models.user import User
from app.security import issue_session_token
from app.services import erasure, export

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


def _member(s, name: str, email: str) -> str:
    u = User(
        persona_name=name,
        persona_avatar="x",
        dob=date(1996, 1, 1),
        age_at_signup=30,
        email=email,
        companion_animal="Cat",
        companion_name="Biscuit",
    )
    s.add(u)
    s.flush()
    return u.id


def _mentor(s) -> str:
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        public_line="MENTOR-PRIVATE-LINE",
    )
    s.add(li)
    s.flush()
    return li.id


def _everything_for(s, uid: str, lid: str, tag: str) -> str:
    """One row in every table erasure clears for a member; every free-text field
    carries `tag` so the test can see whose text leaked."""
    c = Conversation(
        user_id=uid, listener_id=lid, pin_hash=f"PINHASH-{tag}", stream_channel_id=f"ch-{tag}"
    )
    s.add(c)
    s.flush()
    s.add_all(
        [
            ConversationReflection(conversation_id=c.id, energy=4),
            JournalEntry(
                user_id=uid, channel=JournalChannel.gratitude, body=f"JOURNAL-{tag}", meta={}
            ),
            FavouriteListener(user_id=uid, listener_id=lid),
            MentorLink(
                user_id=uid,
                listener_id=lid,
                conversation_id=c.id,
                first_met_as="Open River",
                first_met_at=datetime.now(UTC),
            ),
            ConversationRequest(
                requester_id=uid, target_listener_id=lid, intro_message=f"INTRO-{tag}"
            ),
            PushToken(
                user_id=uid,
                owner_kind=PushOwnerKind.member,
                owner_id=uid,
                expo_push_token=f"ExponentPushToken[TOKEN-{tag}]",
                platform="android",
            ),
            MessageAllowanceDay(user_id=uid, day=date(2026, 9, 27), sent=3),
            ListenerApplication(
                user_id=uid,
                motivation=f"MOTIVATION-{tag}",
                communities=["upsc"],
                availability="weekly",
                status=ApplicationStatus.declined,
                decline_reason=f"TEAM-NOTE-{tag}",
                pledge_accepted_at=datetime.now(UTC),
            ),
            Contribution(user_id=uid, amount_paise=5000),
            ModerationEvent(
                reporter_id=uid,
                reporter_kind=ReporterKind.member,
                subject_id=lid,
                conversation_id=c.id,
                reason=f"MY-REPORT-{tag}",
            ),
            # Held ABOUT the member — never exported.
            ModerationEvent(
                reporter_id=lid,
                reporter_kind=ReporterKind.listener,
                subject_id=uid,
                conversation_id=c.id,
                reason=f"MENTOR-REPORT-ABOUT-{tag}",
            ),
            SafetyFlag(user_id=uid, conversation_id=c.id, signal=SafetySignal.suicidal),
        ]
    )
    s.flush()
    return c.id


def _export(client, uid: str) -> dict:
    r = client.get(
        "/api/v1/me/export", headers={"Authorization": f"Bearer {issue_session_token(uid)}"}
    )
    assert r.status_code == 200, r.text
    assert "attachment" in r.headers.get("content-disposition", "")
    return r.json()


def test_export_holds_the_members_own_rows_and_nothing_else(client, db_session):
    with TestSession() as s:
        lid = _mentor(s)
        a = _member(s, "Quiet Cove", "a@example.com")
        b = _member(s, "Still Pine", "b@example.com")
        convo_a = _everything_for(s, a, lid, "A")
        _everything_for(s, b, lid, "B")
        s.commit()

    data = _export(client, a)
    raw = json.dumps(data)

    # Theirs, all of it.
    assert data["profile"]["persona_name"] == "Quiet Cove"
    assert data["profile"]["email"] == "a@example.com"
    assert data["profile"]["dob"] == "1996-01-01"
    assert data["profile"]["companion_name"] == "Biscuit"
    assert [c["id"] for c in data["conversations"]] == [convo_a]
    assert data["conversations"][0]["mentor_name"] == "Open River"
    assert [r["energy"] for r in data["reflections"]] == [4]
    assert [j["body"] for j in data["journal_entries"]] == ["JOURNAL-A"]
    assert [f["mentor_name"] for f in data["favourites"]] == ["Open River"]
    assert [link["first_met_as"] for link in data["stay_in_touch_links"]] == ["Open River"]
    assert [r["intro_message"] for r in data["requests"]] == ["INTRO-A"]
    assert [t["platform"] for t in data["push_devices"]] == ["android"]
    assert [d["sent"] for d in data["allowance_days"]] == [3]
    assert [a_["motivation"] for a_ in data["applications"]] == ["MOTIVATION-A"]
    assert [c["amount_paise"] for c in data["contributions"]] == [5000]
    assert [r["reason"] for r in data["reports_filed"]] == ["MY-REPORT-A"]

    # Nobody else's, and nothing that is not theirs to take.
    for leak in (
        b,
        "Still Pine",
        "b@example.com",
        "-B",  # every B free-text field ends in -B
        lid,  # a mentor's internal id
        "MENTOR-PRIVATE-LINE",
        "PINHASH-A",
        "TOKEN-A",
        "TEAM-NOTE-A",
        "MENTOR-REPORT-ABOUT-A",
        "ch-A",
        "suicidal",
    ):
        assert leak not in raw, leak
    # Chat text is on Stream, never here — the export says so rather than implying a
    # full transcript.
    assert "messages" not in data
    assert data["notes"]["messages"]


def test_every_table_erasure_clears_is_in_the_export():
    """Structural guard: a table added to erasure's inventory without an export
    section fails here, so the two cannot drift apart."""
    exported = set(export.SECTIONS_BY_ERASURE_KEY)
    assert exported == set(erasure.MEMBER_TABLES)


def test_export_of_an_unknown_session_is_401(client, db_session):
    r = client.get(
        "/api/v1/me/export", headers={"Authorization": f"Bearer {issue_session_token('gone')}"}
    )
    assert r.status_code == 401


def test_member_tables_matches_what_erasure_really_deletes(db_session, monkeypatch):
    """MEMBER_TABLES is the constant the export follows; this pins it to the keys phase C
    actually reports, so a new deletion there cannot skip the export."""
    from app.services import stream

    monkeypatch.setattr(stream, "erase_channel", lambda channel_id: None)
    monkeypatch.setattr(stream, "delete_user", lambda user_id: None)
    with TestSession() as s:
        uid = _member(s, "Quiet Cove", "a@example.com")
        s.commit()
        done = erasure.erase_member(s, uid)
    assert done is not None
    deleted = {k for k in done.counts if not k.endswith("_detached")}
    assert deleted == set(erasure.MEMBER_TABLES)
