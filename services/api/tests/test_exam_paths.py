"""Exam roads and the accept rule (docs/DECISIONS.md §N): the Path offers the common Indian exams,
an exam niche waits for a mentor's accept, and life in general keeps the instant match."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.main import app
from app.models.enums import ListenerStatus, RequestStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.request import ConversationRequest
from app.models.user import User
from app.security import issue_session_token
from app.services import paths, stream
from app.services.paths_data import COMMUNITIES, TREE, TREE_ROOT

from .conftest import TestSession, requires_postgres

EXAM_ROADS = [
    "upsc",
    "neet",
    "jee",
    "exams",
    "ssc",
    "banking",
    "railways",
    "psc",
    "defence",
    "teaching",
    "gate",
    "cuet",
    "law",
    "mba",
    "ugcnet",
    "ca",
    "boards",
]


@pytest.fixture(autouse=True)
def _stream(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )
    monkeypatch.setattr(stream, "post_message", lambda *a, **k: None)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(
            text("TRUNCATE users, listener_profiles, conversations, conversation_requests CASCADE")
        )
        s.commit()
    yield


def _member(s, community: str | None = None) -> str:
    u = User(
        persona_name="Quiet Cove",
        persona_avatar="x",
        dob=date(1996, 1, 1),
        age_at_signup=30,
        community_slug=community,
        journey_stage=next(iter(COMMUNITIES[community]["stages"])) if community else None,
    )
    s.add(u)
    s.flush()
    return u.id


def _mentor(
    s, name="Open River", *, community=None, status=ListenerStatus.online, certified=True
) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="seed",
        categories=[],
        status=status,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
        community_slug=community,
        certified_exam=certified,
    )
    s.add(li)
    s.flush()
    return li.id


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


# --- the road map ------------------------------------------------------------


def test_every_option_in_the_tree_resolves_and_every_road_has_stages_and_prompts():
    for node in TREE.values():
        for option in node["options"]:
            if "next" in option:
                assert option["next"] in TREE
            else:
                assert option["stage"] in COMMUNITIES[option["community"]]["stages"]
    for slug in EXAM_ROADS + ["life"]:
        assert COMMUNITIES[slug]["stages"], slug
        for stage in COMMUNITIES[slug]["stages"].values():
            assert stage["title"] and stage["blurb"] and stage["prompts"], slug


def test_every_exam_road_is_reachable_from_the_root_in_a_few_taps_and_each_stage_is_a_leaf():
    reachable, depth = set(), {TREE_ROOT: 0}
    queue = [TREE_ROOT]
    while queue:
        node = queue.pop(0)
        for option in TREE[node]["options"]:
            if "next" in option:
                depth[option["next"]] = min(depth.get(option["next"], 9), depth[node] + 1)
                queue.append(option["next"])
            else:
                reachable.add((option["community"], option["stage"]))
                assert depth[node] + 1 <= 4, (
                    option,
                    "too deep",
                )  # root > exam > group > road > stage
    for slug in EXAM_ROADS + ["life"]:
        for stage in COMMUNITIES[slug]["stages"]:
            assert (slug, stage) in reachable, (slug, stage)


def test_the_common_roads_are_one_tap_from_the_exam_question():
    labels = [o["label"] for o in TREE["q_exam"]["options"]]
    assert labels[:3] == ["UPSC", "NEET", "JEE"]
    assert "A different exam" in labels


def test_prompts_are_plain_first_person_sentences_without_identity_or_money_words():
    banned = ("rupee", "₹", "salary", "pay ", "fee ", "@", "http", "phone", "whatsapp")
    for slug, c in COMMUNITIES.items():
        for stage in c["stages"].values():
            for prompt in stage["prompts"]:
                assert 8 <= len(prompt) <= 90, (slug, prompt)
                assert not any(word in prompt.lower() for word in banned), (slug, prompt)


def test_ids_fit_the_columns():
    for slug, c in COMMUNITIES.items():
        assert len(slug) <= 32
        assert all(
            len(stage) <= 48 for stage in c["stages"]
        ), slug  # users.journey_stage is String(48)


def test_exam_roads_are_accept_first_and_life_is_not():
    for slug in EXAM_ROADS:
        assert paths.accept_first(slug), slug
    assert not paths.accept_first("life")
    assert not paths.accept_first(None)
    assert not paths.accept_first("not-a-road")


def test_community_info_carries_the_flag():
    assert paths.community_info("ssc")["accept_first"] is True
    assert paths.community_info("life")["accept_first"] is False


# --- the accept rule over HTTP -------------------------------------------------


@requires_postgres
def test_instant_match_is_refused_for_an_exam_niche_with_a_clear_code(client):
    with TestSession() as s:
        member = _member(s, "ssc")
        _mentor(s)
        s.commit()
    r = client.post("/api/v1/match", json={"kind": "general"}, headers=_auth(member))
    assert r.status_code == 409
    assert r.json()["code"] == "accept_required"
    with TestSession() as s:
        assert (
            s.scalars(select(ConversationRequest)).first() is None
        )  # nothing opened, nothing queued


@requires_postgres
@pytest.mark.parametrize("community", [None, "life"])
def test_life_in_general_and_no_path_keep_the_instant_match(client, community):
    with TestSession() as s:
        member = _member(s, community)
        _mentor(s)
        s.commit()
    r = client.post("/api/v1/match", json={"kind": "general"}, headers=_auth(member))
    assert r.status_code == 200
    assert r.json()["conversation_id"]


@requires_postgres
def test_ask_sends_the_question_to_the_best_online_mentor_and_opens_no_chat(client):
    with TestSession() as s:
        member = _member(s, "banking")
        other = _mentor(s, "Open River")
        niche = _mentor(s, "Quiet Pine", community="banking")
        _mentor(s, "Away Owl", status=ListenerStatus.away)
        s.commit()
    r = client.post(
        "/api/v1/match/ask",
        json={"intro_message": "Mock scores swing a lot"},
        headers=_auth(member),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending" and body["conversation_id"] is None
    assert body["target_listener_id"] == niche != other  # the same-road mentor is preferred
    assert body["intro_message"] == "Mock scores swing a lot"
    with TestSession() as s:
        assert s.scalars(select(ConversationRequest)).one().status == RequestStatus.pending
        listener = s.get(ListenerProfile, niche)
        assert listener.active_conversations == 0  # no capacity is reserved until they accept


@requires_postgres
def test_ask_with_nobody_online_is_503_so_the_app_can_offer_the_other_doors(client):
    with TestSession() as s:
        member = _member(s, "ca")
        _mentor(s, "Away Owl", status=ListenerStatus.away)
        s.commit()
    r = client.post("/api/v1/match/ask", json={}, headers=_auth(member))
    assert (
        r.status_code == 503
    )  # nobody online: the app then offers Browse, Become a mentor, Invite


@requires_postgres
def test_ask_default_intro_and_one_open_question_at_a_time(client):
    with TestSession() as s:
        member = _member(s, "mba")
        _mentor(s)
        s.commit()
    first = client.post("/api/v1/match/ask", json={}, headers=_auth(member))
    assert first.status_code == 200
    assert first.json()["intro_message"].startswith("I'd like to talk")
    second = client.post("/api/v1/match/ask", json={}, headers=_auth(member))
    assert second.status_code == 409 and second.json()["code"] == "question_open"


@requires_postgres
def test_a_mentor_accepting_the_ask_opens_the_chat(client):
    with TestSession() as s:
        member = _member(s, "gate")
        mentor = _mentor(s)
        s.commit()
    asked = client.post("/api/v1/match/ask", json={}, headers=_auth(member)).json()
    from app.services import matching

    with TestSession() as s:
        req = matching.accept_personal_request(s, asked["id"], acting_listener_id=mentor)
        assert req.status == RequestStatus.matched and req.conversation_id


@requires_postgres
def test_path_me_reports_accept_first(client):
    with TestSession() as s:
        member = _member(s)
        s.commit()
    put = client.put(
        "/api/v1/paths/me",
        json={"community": "defence", "stage": "starting"},
        headers=_auth(member),
    )
    assert put.status_code == 200, put.text
    assert put.json()["community"]["accept_first"] is True
    put = client.put(
        "/api/v1/paths/me", json={"community": "life", "stage": "heavy_days"}, headers=_auth(member)
    )
    assert put.json()["community"]["accept_first"] is False


def test_communities_endpoint_names_every_road(client):
    r = client.get("/api/v1/paths/communities")
    assert r.status_code == 200
    by_slug = {c["slug"]: c for c in r.json()}
    assert by_slug["life"]["accept_first"] is False
    assert by_slug["upsc"]["accept_first"] is True and by_slug["upsc"]["name"] == "UPSC"
    assert {"ssc", "banking", "railways", "gate", "cuet"} <= set(by_slug)


def test_an_exam_ask_goes_only_to_a_certified_mentor(client):
    """DECISIONS section O: an ordinary listener never receives an exam question."""
    with TestSession() as s:
        _mentor(s, "Plain Willow", community="upsc", certified=False)
        member = _member(s, "upsc")
        s.commit()
    r = client.post("/api/v1/match/ask", json={}, headers=_auth(member))
    assert r.status_code == 503  # nobody certified is online: the busy card, not a wrong mentor

    with TestSession() as s:
        certified = _mentor(s, "Certified Cedar", certified=True)
        s.commit()
    r = client.post("/api/v1/match/ask", json={}, headers=_auth(member))
    assert r.status_code == 200, r.text
    assert r.json()["target_listener_id"] == certified
