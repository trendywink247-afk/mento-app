"""Path (Communities): pathfinder tree, choose/clear, and matcher community preference."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models.enums import ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_session_token
from app.services import stream
from app.services.matching import match_general
from app.services.paths_data import COMMUNITIES, TREE, TREE_ROOT

from .conftest import TestSession, requires_postgres


@pytest.fixture(autouse=True)
def _stream(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(text("TRUNCATE users, listener_profiles, conversations CASCADE"))
        s.commit()
    yield


def _seed_user(s) -> str:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _seed_listener(s, *, name, community=None, rank=10) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="seed",
        categories=["loneliness"],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=rank,
        active_conversations=0,
        max_concurrent=3,
        community_slug=community,
    )
    s.add(li)
    s.flush()
    return li.id


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


# --- config sanity -----------------------------------------------------------


def test_every_tree_leaf_points_at_a_real_stage():
    for node in TREE.values():
        for opt in node["options"]:
            if "next" in opt:
                assert opt["next"] in TREE
            else:
                assert opt["community"] in COMMUNITIES
                assert opt["stage"] in COMMUNITIES[opt["community"]]["stages"]


def test_tree_endpoint_shape(client):
    body = client.get("/api/v1/paths/tree").json()
    assert body["root"] == TREE_ROOT
    assert body["root"] in body["nodes"]
    assert all("question" in n and "options" in n for n in body["nodes"].values())


# --- choose / read / clear ----------------------------------------------------


@requires_postgres
def test_choose_read_and_clear_path(client):
    with TestSession() as s:
        uid = _seed_user(s)
        _seed_listener(s, name="Walked River", community="upsc")
        s.commit()

    # Nothing chosen yet.
    assert client.get("/api/v1/paths/me", headers=_auth(uid)).json()["community"] is None

    res = client.put(
        "/api/v1/paths/me",
        json={"community": "upsc", "stage": "prelims_wait"},
        headers=_auth(uid),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["community"]["slug"] == "upsc"
    assert body["stage"]["title"] == "The wait after prelims"
    assert body["prompts"]  # warm-ups always present
    assert body["listeners_online"] == 1

    assert client.delete("/api/v1/paths/me", headers=_auth(uid)).status_code == 204
    assert client.get("/api/v1/paths/me", headers=_auth(uid)).json()["community"] is None


@requires_postgres
def test_choose_rejects_unknown_community_or_stage(client):
    with TestSession() as s:
        uid = _seed_user(s)
        s.commit()
    for bad in (
        {"community": "hogwarts", "stage": "year_one"},
        {"community": "upsc", "stage": "not_a_stage"},
    ):
        assert client.put("/api/v1/paths/me", json=bad, headers=_auth(uid)).status_code == 422


# --- matcher preference --------------------------------------------------------


@requires_postgres
def test_matcher_prefers_same_community_listener():
    """A higher-ranked off-community listener must lose to a same-community one
    (community is the strongest soft preference)."""
    with TestSession() as s:
        uid = _seed_user(s)
        user = s.get(User, uid)
        user.community_slug = "upsc"
        user.journey_stage = "foundation"
        _seed_listener(s, name="Louder Peak", community=None, rank=99)
        upsc_id = _seed_listener(s, name="Walked River", community="upsc", rank=1)
        s.commit()

        convo = match_general(s, user)
        assert convo.listener_id == upsc_id


@requires_postgres
def test_matcher_never_strands_user_without_community_listener():
    """Soft preference: no same-road listener online still matches someone."""
    with TestSession() as s:
        uid = _seed_user(s)
        user = s.get(User, uid)
        user.community_slug = "neet"
        user.journey_stage = "repeat_year"
        other_id = _seed_listener(s, name="Any Harbor", community="upsc")
        s.commit()

        convo = match_general(s, user)
        assert convo.listener_id == other_id
