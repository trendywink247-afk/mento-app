"""Mentor console fields behind the new Home and Requests screens (DECISIONS §P.6): the mentor's own
usual reply time, and the road and stage a member chose to share on each request."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import (
    ConversationStatus,
    ListenerStatus,
    RequestKind,
    RequestStatus,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.request import ConversationRequest
from app.models.user import User
from app.security import issue_listener_token
from app.services.paths_data import COMMUNITIES

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, conversations, conversation_requests, "
                "request_passes CASCADE"
            )
        )
        s.commit()
    yield


def _mentor(s) -> str:
    li = ListenerProfile(
        persona_name="Gentle Meadow",
        persona_avatar="seed",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
        certified_exam=True,
    )
    s.add(li)
    s.flush()
    return li.id


def _member(s, community="upsc") -> User:
    stage = next(iter(COMMUNITIES[community]["stages"])) if community else None
    u = User(
        persona_name="Quiet Cove",
        persona_avatar="x",
        dob=date(1996, 1, 1),
        age_at_signup=30,
        community_slug=community,
        journey_stage=stage,
    )
    s.add(u)
    s.flush()
    return u


def _h(listener_id):
    return {"Authorization": f"Bearer {issue_listener_token(listener_id)}"}


def test_me_has_no_reply_time_until_there_is_enough_to_say(client):
    with TestSession() as s:
        li = _mentor(s)
        s.commit()
    r = client.get("/api/v1/listener/me", headers=_h(li))
    assert r.status_code == 200 and r.json()["reply_within"] is None


def test_me_shows_the_usual_reply_time_after_five_answered_requests(client):
    with TestSession() as s:
        li = _mentor(s)
        m = _member(s)
        for hours in (1, 2, 3, 4, 5):
            asked = datetime.now(UTC) - timedelta(hours=100)
            convo = Conversation(
                user_id=m.id,
                listener_id=li,
                status=ConversationStatus.ended,
                created_at=asked + timedelta(hours=hours),
            )
            s.add(convo)
            s.flush()
            s.add(
                ConversationRequest(
                    kind=RequestKind.personal,
                    status=RequestStatus.matched,
                    requester_id=m.id,
                    target_listener_id=li,
                    conversation_id=convo.id,
                    created_at=asked,
                )
            )
        s.commit()
    assert client.get("/api/v1/listener/me", headers=_h(li)).json()["reply_within"] == "day"


def test_a_request_shows_the_road_and_stage_the_member_chose(client):
    with TestSession() as s:
        li = _mentor(s)
        m = _member(s)
        s.add(
            ConversationRequest(
                kind=RequestKind.personal,
                status=RequestStatus.pending,
                requester_id=m.id,
                target_listener_id=li,
                intro_message="Hello",
            )
        )
        s.commit()
    row = client.get("/api/v1/listener/me/requests", headers=_h(li)).json()[0]
    assert row["community_label"] == "UPSC" and row["stage_label"]
    # The member's age reaches the mentor only as a band.
    assert row["age_band"] in {"25–34", "35–44", "45+", "18–24"} and "dob" not in row
    assert row["audience"] == "any"


def test_a_member_with_no_road_has_no_labels(client):
    with TestSession() as s:
        li = _mentor(s)
        m = _member(s, community=None)
        s.add(
            ConversationRequest(
                kind=RequestKind.personal,
                status=RequestStatus.pending,
                requester_id=m.id,
                target_listener_id=li,
            )
        )
        s.commit()
    row = client.get("/api/v1/listener/me/requests", headers=_h(li)).json()[0]
    assert row["community_label"] is None and row["stage_label"] is None


def test_age_band_is_coarse_and_never_below_eighteen():
    from datetime import date

    from app.services.age_band import age_band

    today = date(2026, 11, 10)
    assert age_band(date(2008, 11, 10), today) == "18–24"  # turned 18 today
    assert age_band(date(2008, 11, 11), today) is None  # still 17
    assert age_band(date(2002, 1, 1), today) == "18–24"
    assert age_band(date(1999, 1, 1), today) == "25–34"
    assert age_band(date(1990, 1, 1), today) == "35–44"
    assert age_band(date(1970, 1, 1), today) == "45+"
    assert age_band(None, today) is None
