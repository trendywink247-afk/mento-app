"""T2.3: the unbounded list endpoints take `limit` (default 50, max 200) and `cursor`.

The response stays a plain JSON list (installed apps keep working); the next page's
cursor travels in the `X-Next-Cursor` header, absent on the last page. Keyset cursors,
so a page boundary never repeats or drops a row the unpaged order would have shown.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import (
    LinkStatus,
    ListenerStatus,
    RequestKind,
    RequestStatus,
    VettingStatus,
)
from app.models.favourite import FavouriteListener
from app.models.listener import ListenerProfile
from app.models.mentor_link import MentorLink
from app.models.request import ConversationRequest
from app.models.user import User
from app.security import issue_listener_token, issue_session_token

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres

HEADER = "X-Next-Cursor"


@pytest.fixture
def client():
    return TestClient(app)


def _user(s, name="Quiet Cove") -> str:
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _listener(s, name: str, rank: int, status=ListenerStatus.online) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="x",
        categories=[],
        status=status,
        vetting_status=VettingStatus.approved,
        rank=rank,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _pages(client, path: str, headers: dict, limit: int) -> list[list[dict]]:
    pages, cursor = [], None
    while True:
        params = {"limit": limit} | ({"cursor": cursor} if cursor else {})
        r = client.get(path, headers=headers, params=params)
        assert r.status_code == 200, r.text
        pages.append(r.json())
        cursor = r.headers.get(HEADER)
        if not cursor:
            return pages
        assert len(pages) < 20, "cursor never ended"


# --- Browse: GET /listeners ---------------------------------------------------------


def test_listener_directory_pages_in_the_unpaged_order(client, db_session):
    with TestSession() as s:
        uid = _user(s)
        ids = [_listener(s, f"Mentor {i}", rank=i % 3) for i in range(7)]
        away = _listener(s, "Away One", rank=99, status=ListenerStatus.away)
        # One in touch, one favourite: they lead, whatever their rank.
        s.add(
            MentorLink(
                user_id=uid,
                listener_id=ids[0],
                status=LinkStatus.accepted,
                first_met_as="Mentor 0",
                first_met_at=datetime.now(UTC),
            )
        )
        s.add(FavouriteListener(user_id=uid, listener_id=ids[1]))
        s.commit()
    auth = {"Authorization": f"Bearer {issue_session_token(uid)}"}

    whole = client.get("/api/v1/listeners", headers=auth, params={"limit": 200})
    assert whole.status_code == 200 and HEADER not in whole.headers
    order = [x["id"] for x in whole.json()]
    assert len(order) == 8
    assert order[0] == ids[0] and order[1] == ids[1]  # in touch, then favourite
    assert order[-1] == away  # unavailable sinks below every available mentor

    pages = _pages(client, "/api/v1/listeners", auth, limit=3)
    assert [len(p) for p in pages] == [3, 3, 2]
    assert [x["id"] for p in pages for x in p] == order


def test_listener_directory_defaults_to_fifty(client, db_session):
    with TestSession() as s:
        uid = _user(s)
        for i in range(51):
            _listener(s, f"Mentor {i}", rank=0)
        s.commit()
    r = client.get(
        "/api/v1/listeners", headers={"Authorization": f"Bearer {issue_session_token(uid)}"}
    )
    assert len(r.json()) == 50 and r.headers.get(HEADER)


@pytest.mark.parametrize("params", [{"limit": 201}, {"limit": 0}, {"cursor": "not-a-cursor"}])
def test_bad_paging_is_a_422(client, db_session, params):
    with TestSession() as s:
        uid = _user(s)
        lid = _listener(s, "Open River", rank=0)
        s.commit()
    member = {"Authorization": f"Bearer {issue_session_token(uid)}"}
    mentor = {"Authorization": f"Bearer {issue_listener_token(lid)}"}
    assert client.get("/api/v1/listeners", headers=member, params=params).status_code == 422
    assert (
        client.get("/api/v1/listener/me/requests", headers=mentor, params=params).status_code == 422
    )


# --- Mentor inbox: GET /listener/me/requests -----------------------------------------


def test_inbox_pages_oldest_first_and_never_writes(client, db_session):
    with TestSession() as s:
        lid = _listener(s, "Open River", rank=0)
        base = datetime.now(UTC) - timedelta(hours=1)
        want = []
        for i in range(5):
            req = ConversationRequest(
                kind=RequestKind.personal,
                requester_id=_user(s, f"Member {i}"),
                target_listener_id=lid,
                intro_message=f"question {i}",
                created_at=base + timedelta(minutes=i),
            )
            s.add(req)
            s.flush()
            want.append(req.id)
        s.commit()
    auth = {"Authorization": f"Bearer {issue_listener_token(lid)}"}

    pages = _pages(client, "/api/v1/listener/me/requests", auth, limit=2)
    assert [len(p) for p in pages] == [2, 2, 1]
    assert [x["id"] for p in pages for x in p] == want
    with TestSession() as s:
        assert (
            s.scalars(
                select(ConversationRequest.seen_at).where(ConversationRequest.seen_at.is_not(None))
            ).all()
            == []
        )


def test_marking_seen_stamps_only_the_mentors_own_pending_requests(client, db_session):
    with TestSession() as s:
        lid = _listener(s, "Open River", rank=0)
        other = _listener(s, "Calm Grove", rank=0)
        mine = ConversationRequest(requester_id=_user(s), target_listener_id=lid)
        theirs = ConversationRequest(requester_id=_user(s, "B"), target_listener_id=other)
        done = ConversationRequest(
            requester_id=_user(s, "C"), target_listener_id=lid, status=RequestStatus.expired
        )
        s.add_all([mine, theirs, done])
        s.commit()
        ids = [mine.id, theirs.id, done.id]
    r = client.post(
        "/api/v1/listener/me/requests/seen",
        headers={"Authorization": f"Bearer {issue_listener_token(lid)}"},
        json={"request_ids": ids},
    )
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    with TestSession() as s:
        seen = {
            rid: at
            for rid, at in s.execute(
                select(ConversationRequest.id, ConversationRequest.seen_at)
            ).all()
        }
    assert seen[ids[0]] is not None
    assert seen[ids[1]] is None and seen[ids[2]] is None


def test_mark_seen_is_bounded(client, db_session):
    with TestSession() as s:
        lid = _listener(s, "Open River", rank=0)
        s.commit()
    r = client.post(
        "/api/v1/listener/me/requests/seen",
        headers={"Authorization": f"Bearer {issue_listener_token(lid)}"},
        json={"request_ids": [f"id-{i}" for i in range(201)]},
    )
    assert r.status_code == 422


# --- In touch: the latest conversation per mentor, not every conversation ------------


def test_in_touch_shows_the_latest_conversation_with_each_mentor(client, db_session):
    with TestSession() as s:
        uid = _user(s)
        lid = _listener(s, "Open River", rank=0)
        base = datetime.now(UTC) - timedelta(days=1)
        latest = None
        for i in range(6):
            c = Conversation(user_id=uid, listener_id=lid, created_at=base + timedelta(hours=i))
            s.add(c)
            s.flush()
            latest = c.id
        s.add(
            MentorLink(
                user_id=uid,
                listener_id=lid,
                status=LinkStatus.accepted,
                first_met_as="Open River",
                first_met_at=base,
            )
        )
        s.commit()
    r = client.get(
        "/api/v1/in-touch", headers={"Authorization": f"Bearer {issue_session_token(uid)}"}
    )
    assert r.status_code == 200, r.text
    [item] = r.json()["items"]
    assert item["conversation_id"] == latest
