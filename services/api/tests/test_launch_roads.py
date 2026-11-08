"""Launch scope (docs/DECISIONS.md §P.1): only UPSC and life in general are open; the other
roads are listed as not enabled (the app greys them out) and the server refuses them."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.config import get_settings
from app.main import app
from app.models.user import User
from app.security import issue_session_token
from app.services import paths
from app.services.paths_data import COMMUNITIES

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def launch(monkeypatch):
    monkeypatch.setenv("LAUNCH_ROADS", "upsc,life")
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(text("TRUNCATE users CASCADE"))
        s.commit()
    yield


def _member(community: str | None = None) -> str:
    with TestSession() as s:
        u = User(
            persona_name="Quiet Cove",
            persona_avatar="x",
            dob=date(1996, 1, 1),
            age_at_signup=30,
            community_slug=community,
            journey_stage=next(iter(COMMUNITIES[community]["stages"])) if community else None,
        )
        s.add(u)
        s.commit()
        return u.id


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


def test_launch_roads_are_upsc_and_life(launch):
    assert paths.is_open("upsc") and paths.is_open("life") and paths.is_open(None)
    assert not paths.is_open("jee") and not paths.is_open("neet")


def test_an_empty_launch_list_opens_every_road():
    assert paths.is_open("jee") and paths.is_open("boards")


def test_communities_say_which_roads_are_enabled(client, launch):
    rows = {r["slug"]: r["enabled"] for r in client.get("/api/v1/paths/communities").json()}
    assert rows["upsc"] is True and rows["life"] is True
    assert rows["jee"] is False and rows["neet"] is False


def test_a_closed_road_cannot_be_chosen_and_an_open_one_can(client, launch):
    uid = _member()
    stage = next(iter(COMMUNITIES["jee"]["stages"]))
    r = client.put("/api/v1/paths/me", json={"community": "jee", "stage": stage}, headers=_auth(uid))
    assert r.status_code == 422
    stage = next(iter(COMMUNITIES["upsc"]["stages"]))
    r = client.put("/api/v1/paths/me", json={"community": "upsc", "stage": stage}, headers=_auth(uid))
    assert r.status_code == 200 and r.json()["community"]["enabled"] is True


def test_asking_on_a_closed_road_is_refused(client, launch):
    uid = _member("jee")
    r = client.post("/api/v1/match/ask", json={}, headers=_auth(uid))
    assert r.status_code == 409 and r.json()["code"] == "road_closed"


def test_the_tree_marks_closed_roads_and_keeps_the_exam_route_open(client, launch):
    nodes = client.get("/api/v1/paths/tree").json()["nodes"]
    exam = {o["label"]: o["enabled"] for o in nodes["q_exam"]["options"]}
    assert exam.pop("UPSC") is True
    assert exam and not any(exam.values())  # NEET, JEE and the other exam groups
    root = {o["label"]: o["enabled"] for o in nodes["q_root"]["options"]}
    assert all(root.values())  # the exam route still has UPSC, life is open
    assert all(o["enabled"] for o in nodes["q_upsc_stage"]["options"])
    assert not any(o["enabled"] for o in nodes["q_jee_stage"]["options"])


def test_with_no_launch_list_every_option_is_enabled(client):
    nodes = client.get("/api/v1/paths/tree").json()["nodes"]
    assert all(o["enabled"] for n in nodes.values() for o in n["options"])
