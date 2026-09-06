"""Mentee brief, "Context for care" (spec 2026-09-06 §4): GET
/listener/me/conversations/{id}/brief. Scoping mirrors the other console
routes (opaque 404 for a conversation you don't own); labels must never 500 on
stale config; the Stream lookup is fail-soft."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, SafetySignal, VettingStatus
from app.models.listener import ListenerProfile
from app.models.safety import SafetyFlag
from app.models.user import User
from app.security import issue_listener_token
from app.services import stream

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture(autouse=True)
def _stream_stub(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )
    monkeypatch.setattr(stream, "user_token", lambda uid: f"stub::{uid}")


@pytest.fixture
def client():
    return TestClient(app)


def _listener_auth(listener_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_listener_token(listener_id)}"}


def _seed_user(s, name="Quiet Cove", **kwargs) -> User:
    u = User(
        persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30, **kwargs
    )
    s.add(u)
    s.flush()
    return u


def _seed_listener(s, *, name="Open River", vetting=VettingStatus.approved) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="river",
        categories=["loneliness"],
        status=ListenerStatus.online,
        vetting_status=vetting,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


def _seed_convo(s, *, user_id: str, listener_id: str, **kwargs) -> Conversation:
    convo = Conversation(
        user_id=user_id,
        listener_id=listener_id,
        status=ConversationStatus.active,
        **kwargs,
    )
    s.add(convo)
    s.flush()
    return convo


def _brief_url(convo_id: str) -> str:
    return f"/api/v1/listener/me/conversations/{convo_id}/brief"


@requires_postgres
def test_own_conversation_returns_companion_labels_and_prompt(client, db_session, monkeypatch):
    with TestSession() as s:
        user = _seed_user(
            s,
            name="Misty Vale",
            companion_animal="panda",
            companion_colour="terracotta",
            community_slug="upsc",
            journey_stage="foundation",
        )
        lid = _seed_listener(s)
        convo = _seed_convo(
            s,
            user_id=user.id,
            listener_id=lid,
            issue_category="exam_stress",
            stream_channel_id="chan-1",
        )
        s.commit()
        convo_id = convo.id

    stamp = datetime(2026, 9, 6, 12, 0, tzinfo=UTC)
    monkeypatch.setattr(stream, "channel_last_message_at", lambda channel_id: stamp)

    r = client.get(_brief_url(convo_id), headers=_listener_auth(lid))
    assert r.status_code == 200
    body = r.json()
    assert body["persona_name"] == "Misty Vale"
    assert body["companion_animal"] == "panda"
    assert body["companion_colour"] == "terracotta"
    assert body["community_slug"] == "upsc"
    assert body["community_label"] == "UPSC"
    assert body["journey_stage"] == "foundation"
    assert body["journey_stage_label"] == "Foundation days"
    assert body["issue_category"] == "exam_stress"
    assert body["issue_category_label"] == "Exam stress"
    assert body["last_message_at"] == stamp.isoformat()
    assert body["member_masked"] is False
    assert body["safety_flags_open"] == 0
    assert body["care_prompt"]  # non-empty


@requires_postgres
def test_unknown_community_slug_yields_null_labels_not_500(client, db_session):
    with TestSession() as s:
        user = _seed_user(s, community_slug="atlantis", journey_stage="mythic")
        lid = _seed_listener(s)
        convo = _seed_convo(s, user_id=user.id, listener_id=lid)
        s.commit()
        convo_id = convo.id

    r = client.get(_brief_url(convo_id), headers=_listener_auth(lid))
    assert r.status_code == 200
    body = r.json()
    assert body["community_slug"] == "atlantis"
    assert body["community_label"] is None
    assert body["journey_stage_label"] is None


@requires_postgres
def test_another_listeners_conversation_is_opaque_404(client, db_session):
    with TestSession() as s:
        user = _seed_user(s)
        owner = _seed_listener(s, name="Open River")
        other = _seed_listener(s, name="Calm Grove")
        convo = _seed_convo(s, user_id=user.id, listener_id=owner)
        s.commit()
        convo_id = convo.id

    r = client.get(_brief_url(convo_id), headers=_listener_auth(other))
    assert r.status_code == 404


@requires_postgres
def test_unreviewed_flags_counted_reviewed_excluded(client, db_session):
    with TestSession() as s:
        user = _seed_user(s)
        lid = _seed_listener(s)
        convo = _seed_convo(s, user_id=user.id, listener_id=lid)
        other_user = _seed_user(s, name="Other Cove")
        other_convo = _seed_convo(s, user_id=other_user.id, listener_id=lid)
        s.add(
            SafetyFlag(
                conversation_id=convo.id,
                user_id=user.id,
                signal=SafetySignal.self_harm,
                reviewed=False,
            )
        )
        s.add(
            SafetyFlag(
                conversation_id=convo.id,
                user_id=user.id,
                signal=SafetySignal.self_harm,
                reviewed=True,
            )
        )
        # An unreviewed flag on a DIFFERENT conversation must never bleed into
        # this one's count — the query scopes on conversation_id, not listener.
        s.add(
            SafetyFlag(
                conversation_id=other_convo.id,
                user_id=other_user.id,
                signal=SafetySignal.self_harm,
                reviewed=False,
            )
        )
        s.commit()
        convo_id = convo.id

    r = client.get(_brief_url(convo_id), headers=_listener_auth(lid))
    assert r.status_code == 200
    assert r.json()["safety_flags_open"] == 1


@requires_postgres
def test_last_message_lookup_fails_soft_from_the_endpoint(client, db_session, monkeypatch):
    """The router trusts the helper's own fail-soft contract: if Stream is down
    the helper itself returns None, and the brief still renders."""
    with TestSession() as s:
        user = _seed_user(s)
        lid = _seed_listener(s)
        convo = _seed_convo(s, user_id=user.id, listener_id=lid, stream_channel_id="chan-2")
        s.commit()
        convo_id = convo.id

    monkeypatch.setattr(stream, "channel_last_message_at", lambda channel_id: None)

    r = client.get(_brief_url(convo_id), headers=_listener_auth(lid))
    assert r.status_code == 200
    assert r.json()["last_message_at"] is None


def test_channel_last_message_at_helper_returns_none_on_stream_error(monkeypatch):
    """Unit test of the helper itself (not through the router): a Stream client
    that raises must not propagate — the whole point of the fail-soft contract."""

    class _BoomChannel:
        def query(self, **kwargs):
            raise RuntimeError("stream is down")

    class _BoomClient:
        def channel(self, kind, channel_id):
            return _BoomChannel()

    class _NoRedis:
        def get(self, key):
            raise RuntimeError("redis is down")

        def set(self, key, value, ex=None):
            raise RuntimeError("redis is down")

    monkeypatch.setattr(stream, "_client", lambda: _BoomClient())
    from app import ratelimit

    monkeypatch.setattr(ratelimit, "_redis", lambda: _NoRedis())

    assert stream.channel_last_message_at("chan-boom") is None


@requires_postgres
def test_same_conversation_yields_same_care_prompt_twice(client, db_session):
    with TestSession() as s:
        user = _seed_user(s)
        lid = _seed_listener(s)
        convo = _seed_convo(s, user_id=user.id, listener_id=lid, issue_category="loneliness")
        s.commit()
        convo_id = convo.id

    first = client.get(_brief_url(convo_id), headers=_listener_auth(lid)).json()["care_prompt"]
    second = client.get(_brief_url(convo_id), headers=_listener_auth(lid)).json()["care_prompt"]
    assert first == second


@requires_postgres
def test_masked_member_reads_as_masked(client, db_session):
    with TestSession() as s:
        user = _seed_user(s)
        lid = _seed_listener(s)
        convo = _seed_convo(s, user_id=user.id, listener_id=lid, status_mask="away")
        s.commit()
        convo_id = convo.id

    r = client.get(_brief_url(convo_id), headers=_listener_auth(lid))
    assert r.status_code == 200
    assert r.json()["member_masked"] is True


@requires_postgres
def test_suspended_listener_is_rejected(client, db_session):
    with TestSession() as s:
        user = _seed_user(s)
        lid = _seed_listener(s, vetting=VettingStatus.suspended)
        convo = _seed_convo(s, user_id=user.id, listener_id=lid)
        s.commit()
        convo_id = convo.id

    r = client.get(_brief_url(convo_id), headers=_listener_auth(lid))
    assert r.status_code == 403
