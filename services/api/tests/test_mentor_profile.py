"""Mentor profile — "Two in the room" (spec 2026-09-06 §3.3/§3.4): profile by id
(Browse) and by conversation (chat header), favourites, and Browse ordering.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session as OrmSession

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ApplicationStatus, ConversationStatus, ListenerStatus, VettingStatus
from app.models.favourite import FavouriteListener
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.moderation import ModerationEvent
from app.models.user import User
from app.security import issue_session_token
from app.services import stream

from .conftest import TestSession, requires_postgres


@pytest.fixture(autouse=True)
def _stub_stream(monkeypatch):
    """Hermetic: no live Stream calls even with creds present."""
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )


@pytest.fixture
def client():
    return TestClient(app)


def _seed_user(s, name: str = "Quiet Cove") -> str:
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _seed_listener(
    s,
    *,
    name: str = "Open River",
    vetting: VettingStatus = VettingStatus.approved,
    created_at: datetime | None = None,
    public_line: str | None = "I sat the exam three times.",
    availability_note: str | None = "evenings, weekends",
    community_slug: str | None = None,
) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="river",
        categories=["loneliness"],
        community_slug=community_slug,
        status=ListenerStatus.online,
        vetting_status=vetting,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
        public_line=public_line,
        availability_note=availability_note,
    )
    if created_at is not None:
        li.created_at = created_at
    s.add(li)
    s.flush()
    return li.id


def _seed_convo(
    s, user_id: str, listener_id: str, *, status: ConversationStatus = ConversationStatus.active
) -> str:
    c = Conversation(
        type="anon",
        status=status,
        user_id=user_id,
        listener_id=listener_id,
        stream_channel_id=None,
    )
    s.add(c)
    s.flush()
    return c.id


def _block(s, user_id: str, listener_id: str) -> None:
    s.add(
        ModerationEvent(
            reporter_id=user_id,
            subject_id=listener_id,
            conversation_id=None,
            blocked=True,
            reviewed=False,
        )
    )
    s.flush()


def _own_application(s, user_id: str, listener_id: str) -> None:
    """Mints the "this listener profile came from this member's own application"
    link that `own_listener_ids` reads (session 22 funnel)."""
    s.add(
        ListenerApplication(
            user_id=user_id,
            motivation="Walked the road, want to hold the lamp for the next person.",
            communities=["life"],
            availability="most_evenings",
            status=ApplicationStatus.approved,
            listener_id=listener_id,
            pledge_accepted_at=datetime.now(UTC),
        )
    )
    s.flush()


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


# --- GET /listeners/{id} ---


@requires_postgres
def test_profile_by_id_reports_held_count_and_since(client, db_session):
    since = datetime(2026, 3, 14, tzinfo=UTC)
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s, created_at=since)
        # Wiped and ended conversations still count; only these three do.
        _seed_convo(s, uid, lid, status=ConversationStatus.active)
        _seed_convo(s, uid, lid, status=ConversationStatus.ended)
        _seed_convo(s, uid, lid, status=ConversationStatus.wiped)
        s.commit()

    r = client.get(f"/api/v1/listeners/{lid}", headers=_auth(uid))
    assert r.status_code == 200
    body = r.json()
    assert body["conversations_held"] == 3
    assert body["listening_since"] == "2026-03-14"
    assert body["public_line"] == "I sat the exam three times."
    assert body["availability_note"] == "evenings, weekends"
    assert body["is_favourite"] is False


@requires_postgres
def test_profile_by_id_404_when_not_approved(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s, vetting=VettingStatus.pending)
        s.commit()

    r = client.get(f"/api/v1/listeners/{lid}", headers=_auth(uid))
    assert r.status_code == 404


@requires_postgres
def test_profile_by_id_404_when_blocked(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        _block(s, uid, lid)
        s.commit()

    r = client.get(f"/api/v1/listeners/{lid}", headers=_auth(uid))
    assert r.status_code == 404


@requires_postgres
def test_profile_by_id_404_for_own_minted_listener(client, db_session):
    """A member whose own application was approved must never see their own
    listener profile through Browse (they'd otherwise be able to favourite or
    request themself)."""
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        _own_application(s, uid, lid)
        s.commit()

    r = client.get(f"/api/v1/listeners/{lid}", headers=_auth(uid))
    assert r.status_code == 404


# --- Favourites ---


@requires_postgres
def test_favourite_post_is_idempotent_one_row(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        s.commit()

    first = client.post(f"/api/v1/listeners/{lid}/favourite", headers=_auth(uid))
    second = client.post(f"/api/v1/listeners/{lid}/favourite", headers=_auth(uid))
    assert first.status_code == 200 and second.status_code == 200

    with TestSession() as s:
        rows = s.query(FavouriteListener).filter_by(user_id=uid, listener_id=lid).all()
        assert len(rows) == 1


@requires_postgres
def test_favourite_delete_is_idempotent_200_both_times(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        s.commit()

    client.post(f"/api/v1/listeners/{lid}/favourite", headers=_auth(uid))
    first = client.delete(f"/api/v1/listeners/{lid}/favourite", headers=_auth(uid))
    second = client.delete(f"/api/v1/listeners/{lid}/favourite", headers=_auth(uid))
    assert first.status_code == 200 and second.status_code == 200

    with TestSession() as s:
        rows = s.query(FavouriteListener).filter_by(user_id=uid, listener_id=lid).all()
        assert len(rows) == 0


@requires_postgres
def test_unfavourite_works_after_blocking_the_mentor(client, db_session):
    """DELETE .../favourite is not gated by visibility (spec decision): a member
    who favourited a mentor and later blocked them must still be able to remove
    the favourite, even though the mentor is no longer "visible" to them."""
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        s.commit()

    favourited = client.post(f"/api/v1/listeners/{lid}/favourite", headers=_auth(uid))
    assert favourited.status_code == 200

    with TestSession() as s:
        _block(s, uid, lid)
        s.commit()

    unfavourited = client.delete(f"/api/v1/listeners/{lid}/favourite", headers=_auth(uid))
    assert unfavourited.status_code == 200

    with TestSession() as s:
        rows = s.query(FavouriteListener).filter_by(user_id=uid, listener_id=lid).all()
        assert len(rows) == 0


@requires_postgres
def test_browse_orders_favourites_first_and_is_scoped_per_caller(client, db_session):
    with TestSession() as s:
        uid_a = _seed_user(s, name="A")
        uid_b = _seed_user(s, name="B")
        # Lower-ranked listener will be favourited by A, so it should still sort
        # ahead of the higher-ranked, unfavourited listener.
        lid_favourite = _seed_listener(s, name="Low Rank")
        lid_favourite_obj = s.get(ListenerProfile, lid_favourite)
        lid_favourite_obj.rank = 1
        lid_other = _seed_listener(s, name="High Rank")
        lid_other_obj = s.get(ListenerProfile, lid_other)
        lid_other_obj.rank = 99
        s.commit()

    client.post(f"/api/v1/listeners/{lid_favourite}/favourite", headers=_auth(uid_a))

    browse_a = client.get("/api/v1/listeners", headers=_auth(uid_a))
    assert browse_a.status_code == 200
    rows_a = browse_a.json()
    assert rows_a[0]["id"] == lid_favourite
    assert rows_a[0]["is_favourite"] is True
    assert rows_a[1]["id"] == lid_other
    assert rows_a[1]["is_favourite"] is False

    # Caller B never favourited anything — both listeners read false, ranked order.
    browse_b = client.get("/api/v1/listeners", headers=_auth(uid_b))
    rows_b = browse_b.json()
    assert all(row["is_favourite"] is False for row in rows_b)
    assert rows_b[0]["id"] == lid_other  # rank order restored with no favourites


@requires_postgres
def test_favourite_requires_approved_listener(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s, vetting=VettingStatus.pending)
        s.commit()

    r = client.post(f"/api/v1/listeners/{lid}/favourite", headers=_auth(uid))
    assert r.status_code == 404


@requires_postgres
def test_favourite_404_for_blocked_listener(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        _block(s, uid, lid)
        s.commit()

    r = client.post(f"/api/v1/listeners/{lid}/favourite", headers=_auth(uid))
    assert r.status_code == 404


@requires_postgres
def test_favourite_post_survives_a_raced_insert(client, db_session, monkeypatch):
    """Two concurrent POSTs can both pass the `is None` existence check before
    either commits (TOCTOU); the loser's insert collides on the composite primary
    key. Simulate the race by pre-seeding the row directly (as if another request
    won it) and blinding the endpoint's existence check to it, so it still
    attempts — and must survive — the real IntegrityError from Postgres."""
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        s.commit()

    with TestSession() as s:
        s.add(FavouriteListener(user_id=uid, listener_id=lid))
        s.commit()

    original_get = OrmSession.get

    def _blind_to_favourite(self, entity, ident, *args, **kwargs):
        if entity is FavouriteListener:
            return None
        return original_get(self, entity, ident, *args, **kwargs)

    monkeypatch.setattr(OrmSession, "get", _blind_to_favourite)

    r = client.post(f"/api/v1/listeners/{lid}/favourite", headers=_auth(uid))
    assert r.status_code == 200

    with TestSession() as s:
        rows = s.query(FavouriteListener).filter_by(user_id=uid, listener_id=lid).all()
        assert len(rows) == 1  # still exactly one row — no crash, no duplicate


# --- GET /conversations/{id}/mentor ---


@requires_postgres
def test_conversation_mentor_200_for_owner_404_for_other(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s, name="Owner")
        other_uid = _seed_user(s, name="Stranger")
        lid = _seed_listener(s)
        cid = _seed_convo(s, uid, lid)
        s.commit()

    owner = client.get(f"/api/v1/conversations/{cid}/mentor", headers=_auth(uid))
    assert owner.status_code == 200
    assert owner.json()["id"] == lid

    stranger = client.get(f"/api/v1/conversations/{cid}/mentor", headers=_auth(other_uid))
    assert stranger.status_code == 404


# --- Cascade ---


@requires_postgres
def test_deleting_user_cascades_favourite_row(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        lid = _seed_listener(s)
        s.commit()

    client.post(f"/api/v1/listeners/{lid}/favourite", headers=_auth(uid))

    with TestSession() as s:
        assert s.query(FavouriteListener).filter_by(user_id=uid).count() == 1
        s.delete(s.get(User, uid))
        s.commit()

    with TestSession() as s:
        assert s.query(FavouriteListener).filter_by(user_id=uid).count() == 0
