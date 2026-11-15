"""Own-chat parity with Stream (docs/OWN_CHAT_PARITY.md).

Every room here is a REAL own room: `stream_channel_id` is NULL, as matching creates it.
`chat_helpers.seed_chat` aliases that column to the conversation id, which is exactly
what hid the snooze bug below, so these tests undo the alias.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.config import Settings, get_settings
from app.jobs import tasks
from app.main import app
from app.models.chat_message import ChatMessage
from app.models.conversation import Conversation
from app.models.enums import ConversationEndedBy, ConversationStatus
from app.models.safety import SafetyFlag
from app.routers import health
from app.services import chat, conversations, stream

from .chat_helpers import seed_chat
from .conftest import requires_postgres

pytestmark = requires_postgres

CRISIS = "i want to die"


def own_room(s):
    room = seed_chat(s)
    convo = s.get(Conversation, room.cid)
    convo.stream_channel_id = None  # what matching really writes for an own room
    s.commit()
    return room


def _flags(s, message_id: str) -> list[SafetyFlag]:
    s.expire_all()
    return list(s.scalars(select(SafetyFlag).where(SafetyFlag.stream_message_id == message_id)))


def _send_unflagged_crisis(s, monkeypatch, room, client_id="c1"):
    """A crisis message whose flag write failed (send() is fail-open)."""

    def boom(*a, **k):
        raise RuntimeError("db hiccup")

    with monkeypatch.context() as m:
        m.setattr(chat.safety, "record_flag", boom)
        sent = chat.send(s, room.member_id, room.cid, client_id=client_id, body=CRISIS)
    assert sent.message["crisis"]["signal"] == "suicidal"  # the card still went out
    assert _flags(s, sent.message["id"]) == []
    return sent.message["id"]


# ---- 1. snooze: a mentor's reply ends it in an own room ------------------------------------


def test_a_mentor_reply_ends_the_snooze_in_a_real_own_room(db_session):
    s = db_session
    room = own_room(s)
    convo = s.get(Conversation, room.cid)
    convo.snoozed_until = datetime.now(UTC) + timedelta(hours=6)
    s.commit()
    chat.send(s, room.mentor_id, room.cid, client_id="r1", body="I'm here now")
    # the job send() queued, with the key send() passes
    tasks.snooze_end_on_mentor_reply(channel_id=chat.channel_key(convo), sender_id=room.mentor_id)
    s.expire_all()
    assert s.get(Conversation, room.cid).snoozed_until is None


def test_someone_else_cannot_end_an_own_room_snooze(db_session):
    s = db_session
    room = own_room(s)
    convo = s.get(Conversation, room.cid)
    convo.snoozed_until = datetime.now(UTC) + timedelta(hours=6)
    s.commit()
    tasks.snooze_end_on_mentor_reply(channel_id=room.cid, sender_id=room.member_id)
    s.expire_all()
    assert s.get(Conversation, room.cid).snoozed_until is not None


# ---- 2a. crisis safety net: the reconcile sweep ---------------------------------------------


def test_the_sweep_writes_the_missing_flag_once_and_signal_only(db_session, monkeypatch):
    s = db_session
    room = own_room(s)
    mid = _send_unflagged_crisis(s, monkeypatch, room)
    later = datetime.now(UTC) + chat.RECONCILE_GRACE + timedelta(seconds=5)

    assert chat.reconcile_crisis_flags(s, now=later) == {"found": 1, "written": 1}
    (flag,) = _flags(s, mid)
    assert flag.conversation_id == room.cid and flag.user_id == room.member_id
    assert flag.signal.value == "suicidal"
    assert flag.matched_terms == "suicidal"  # the signal, never the words
    assert CRISIS not in (flag.matched_terms or "") + (flag.category or "")

    # idempotent: nothing left, and a second run writes nothing
    assert chat.reconcile_crisis_flags(s, now=later) == {"found": 0, "written": 0}
    assert len(_flags(s, mid)) == 1


def test_the_sweep_leaves_a_send_in_flight_and_ignores_old_rows(db_session, monkeypatch):
    s = db_session
    room = own_room(s)
    _send_unflagged_crisis(s, monkeypatch, room)
    now = datetime.now(UTC)
    assert chat.reconcile_crisis_flags(s, now=now)["found"] == 0  # inside the grace window
    beyond = now + chat.RECONCILE_LOOKBACK + timedelta(minutes=5)
    assert chat.reconcile_crisis_flags(s, now=beyond)["found"] == 0  # outside the lookback


def test_the_sweep_skips_messages_that_were_flagged_normally(db_session):
    s = db_session
    room = own_room(s)
    sent = chat.send(s, room.member_id, room.cid, client_id="ok1", body=CRISIS)
    assert len(_flags(s, sent.message["id"])) == 1
    later = datetime.now(UTC) + chat.RECONCILE_GRACE + timedelta(seconds=5)
    assert chat.reconcile_crisis_flags(s, now=later)["found"] == 0


def test_the_sweep_survives_a_second_failure_and_retries_next_run(db_session, monkeypatch):
    s = db_session
    room = own_room(s)
    mid = _send_unflagged_crisis(s, monkeypatch, room)
    later = datetime.now(UTC) + chat.RECONCILE_GRACE + timedelta(seconds=5)

    def boom(*a, **k):
        raise RuntimeError("still down")

    with monkeypatch.context() as m:
        m.setattr(chat.safety, "record_flag", boom)
        assert chat.reconcile_crisis_flags(s, now=later) == {"found": 1, "written": 0}
    assert _flags(s, mid) == []
    assert chat.reconcile_crisis_flags(s, now=later) == {"found": 1, "written": 1}


def test_the_sweep_wakes_a_snoozed_chat_like_send_does(db_session, monkeypatch):
    s = db_session
    room = own_room(s)
    convo = s.get(Conversation, room.cid)
    convo.snoozed_until = datetime.now(UTC) + timedelta(hours=6)
    s.commit()

    def boom(*a, **k):
        raise RuntimeError("db hiccup")

    with monkeypatch.context() as m:  # neither the flag nor the snooze end lands at send time
        m.setattr(chat.safety, "record_flag", boom)
        chat.send(s, room.member_id, room.cid, client_id="z1", body=CRISIS)
    s.expire_all()
    assert s.get(Conversation, room.cid).snoozed_until is not None
    chat.reconcile_crisis_flags(s, now=datetime.now(UTC) + chat.RECONCILE_GRACE * 2)
    s.expire_all()
    assert s.get(Conversation, room.cid).snoozed_until is None


def test_the_sweep_is_a_periodic_job_every_five_minutes(db_session):
    from app.jobs import queue

    schedule = {pt.task.name: pt.cron for pt in queue.periodic_registry.periodic_tasks.values()}
    assert schedule["maintenance.crisis_reconcile"] == "*/5 * * * *"
    assert tasks.maintenance_crisis_reconcile(timestamp=0) == {"found": 0, "written": 0}


# ---- 2b. crisis health: own chat can only make an ok answer worse -----------------------------


def _age(s, message_id: str, minutes: int) -> None:
    s.execute(
        update(ChatMessage)
        .where(ChatMessage.id == message_id)
        .values(created_at=datetime.now(UTC) - timedelta(minutes=minutes))
    )
    s.commit()


def test_health_degrades_on_an_old_unflagged_crisis_and_never_shows_a_count(
    db_session, monkeypatch
):
    s = db_session
    monkeypatch.setattr(stream, "is_configured", lambda: False)  # Stream half: "ok (stub)"
    with TestClient(app) as client:
        r = client.get("/api/v1/health/crisis")
        assert r.status_code == 200, r.text
        assert r.json()["own_chat"]["unflagged_backlog"] is False

        room = own_room(s)
        mid = _send_unflagged_crisis(s, monkeypatch, room)
        r = client.get("/api/v1/health/crisis")
        assert r.status_code == 200  # young: the sweep still has time

        _age(s, mid, minutes=16)
        r = client.get("/api/v1/health/crisis")
        assert r.status_code == 503
        body = r.json()
        assert body["status"] == "degraded" and body["own_chat"]["unflagged_backlog"] is True
        assert not any(
            isinstance(v, int) and not isinstance(v, bool) for v in body["own_chat"].values()
        )
        public = client.get("/api/v1/status/public").json()
        assert public["crisis_safety_net"] == "stale"

        chat.reconcile_crisis_flags(s)
        r = client.get("/api/v1/health/crisis")
        assert r.status_code == 200 and r.json()["status"] == "ok"


def test_a_stale_stream_verdict_is_kept_as_it_was(monkeypatch):
    monkeypatch.setattr(health, "_stream_crisis_status", lambda: {"status": "stale", "detail": "x"})
    monkeypatch.setattr(health, "_own_chat_crisis", lambda: {"status": "degraded"})
    out = health._crisis_status()
    assert out["status"] == "stale" and out["detail"] == "x"


def test_an_unknown_own_check_never_fails_an_ok_probe(monkeypatch):
    monkeypatch.setattr(health, "_stream_crisis_status", lambda: {"status": "ok"})
    monkeypatch.setattr(health, "_own_chat_crisis", lambda: {"status": "unknown"})
    assert health._crisis_status()["status"] == "ok"


# ---- 3. boot: Stream keys are needed only while Stream rooms are live -------------------------


def _boot(**overrides) -> str:
    from app import main

    base = dict(
        env="prod",
        jwt_secret="a-real-long-random-secret",
        stream_api_key="",
        stream_api_secret="",
        cors_origins="https://console.example",
        admin_jwt_secret="a-distinct-admin-secret",
        listener_jwt_secret="a-distinct-listener-secret",
        trusted_proxy_hops=1,
        message_key="k1:" + "A" * 43 + "=",
        own_chat_new_conversations=True,
    )
    base.update(overrides)
    original = main.settings
    main.settings = Settings(_env_file=None, **base)
    try:
        main._enforce_prod_invariants()
        return ""
    except RuntimeError as exc:
        return str(exc)
    finally:
        main.settings = original


def test_own_chat_boots_without_stream_keys_when_no_stream_room_is_active(db_session):
    db_session.execute(update(Conversation).values(status=ConversationStatus.ended))
    db_session.commit()
    assert _boot() == ""


def test_an_active_stream_room_still_needs_the_stream_keys(db_session):
    room = seed_chat(db_session)
    convo = db_session.get(Conversation, room.cid)
    convo.chat_backend = "stream"
    db_session.commit()
    assert "STREAM_API_KEY" in _boot()


def test_stream_keys_stay_required_while_own_chat_is_off(db_session):
    assert "STREAM_API_KEY" in _boot(own_chat_new_conversations=False)


def test_own_chat_needs_a_message_key(db_session):
    assert "MESSAGE_KEY" in _boot(message_key="")
    assert "MESSAGE_KEY" not in _boot(
        own_chat_new_conversations=False, stream_api_key="k", stream_api_secret="s", message_key=""
    )


def test_an_uncountable_database_fails_closed(monkeypatch):
    from app import main

    monkeypatch.setattr(main, "_active_stream_conversations", lambda: None)
    assert "STREAM_API_KEY" in _boot()


# ---- the two list fields ----------------------------------------------------------------------


def _member_row(room):
    with TestClient(app) as client:
        r = client.get("/api/v1/conversations", headers={"Authorization": f"Bearer {room.member}"})
    assert r.status_code == 200, r.text
    return next(x for x in r.json() if x["id"] == room.cid)


def _mentor_row(room):
    with TestClient(app) as client:
        r = client.get(
            "/api/v1/listener/me/conversations", headers={"Authorization": f"Bearer {room.mentor}"}
        )
    assert r.status_code == 200, r.text
    return next(x for x in r.json() if x["id"] == room.cid)


def test_member_unread_count_follows_the_read_marker(db_session):
    s = db_session
    room = own_room(s)
    assert _member_row(room)["unread_count"] == 0
    chat.send(s, room.member_id, room.cid, client_id="m1", body="hi")  # mine: never unread
    a = chat.send(s, room.mentor_id, room.cid, client_id="t1", body="hello")
    chat.send(s, room.mentor_id, room.cid, client_id="t2", body="how are you")
    assert _member_row(room)["unread_count"] == 2
    chat.mark_read(s, room.cid, room.member_id, a.message["seq"])
    assert _member_row(room)["unread_count"] == 1


def test_member_unread_count_is_null_for_locked_wiped_and_stream_rows(db_session):
    s = db_session
    room = own_room(s)
    chat.send(s, room.mentor_id, room.cid, client_id="t1", body="hello")
    convo = s.get(Conversation, room.cid)
    convo.is_locked = True
    s.commit()
    assert _member_row(room)["unread_count"] is None

    stream_room = seed_chat(s)
    sc = s.get(Conversation, stream_room.cid)
    sc.chat_backend = "stream"
    s.commit()
    assert _member_row(stream_room)["unread_count"] is None


def test_mentor_list_carries_a_short_preview_for_own_rows_only(db_session):
    s = db_session
    room = own_room(s)
    assert _mentor_row(room)["last_message_preview"] is None  # nothing said yet
    chat.send(s, room.member_id, room.cid, client_id="m1", body="first line\nsecond " + "y" * 300)
    preview = _mentor_row(room)["last_message_preview"]
    assert preview.startswith("first line second") and len(preview) <= 120 and "\n" not in preview

    convo = s.get(Conversation, room.cid)
    conversations.clean_wipe(s, convo, ConversationEndedBy.member)
    s.commit()
    assert _mentor_row(room)["last_message_preview"] is None


def test_mentor_preview_is_null_for_a_stream_row(db_session):
    s = db_session
    room = seed_chat(s)
    convo = s.get(Conversation, room.cid)
    convo.chat_backend = "stream"
    s.commit()
    assert _mentor_row(room)["last_message_preview"] is None


# ---- 4. ended own chats stay readable to both sides; wiped ones are empty --------------------


def _history(room, token):
    with TestClient(app) as client:
        return client.get(
            f"/api/v1/chat/{room.cid}/messages", headers={"Authorization": f"Bearer {token}"}
        )


def test_both_sides_can_read_an_ended_own_chat(db_session):
    s = db_session
    room = own_room(s)
    chat.send(s, room.member_id, room.cid, client_id="m1", body="thank you")
    chat.send(s, room.mentor_id, room.cid, client_id="t1", body="take care")
    convo = s.get(Conversation, room.cid)
    conversations.end(s, convo, ConversationEndedBy.member)
    s.commit()
    for token in (room.member, room.mentor):
        r = _history(room, token)
        assert r.status_code == 200, r.text
        assert [m["text"] for m in r.json()["messages"]] == ["thank you", "take care"]


def test_a_stranger_cannot_read_an_ended_own_chat(db_session):
    s = db_session
    room = own_room(s)
    other = seed_chat(s)
    chat.send(s, room.member_id, room.cid, client_id="m1", body="private")
    conversations.end(s, s.get(Conversation, room.cid), ConversationEndedBy.member)
    s.commit()
    for token in (other.member, other.mentor):
        assert _history(room, token).status_code == 404


def test_a_wiped_own_chat_reads_as_empty(db_session):
    s = db_session
    room = own_room(s)
    chat.send(s, room.member_id, room.cid, client_id="m1", body="please forget this")
    conversations.clean_wipe(s, s.get(Conversation, room.cid), ConversationEndedBy.member)
    s.commit()
    for token in (room.member, room.mentor):
        r = _history(room, token)
        assert r.status_code == 200 and r.json()["messages"] == []


def test_settings_are_untouched_by_this_module():
    # guard: nothing here leaves own chat switched on for other test modules
    assert get_settings().own_chat_new_conversations is False


@pytest.fixture(autouse=True)
def _no_stream_network(monkeypatch):
    monkeypatch.setattr(stream, "is_configured", lambda: False)
