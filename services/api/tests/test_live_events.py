"""Live events socket (docs/LIVE_EVENTS.md): the server pushes, nobody polls.

Against real Postgres, the real endpoint and Valkey pub/sub. "Nobody else heard it" is proven
with a probe: after the action, a probe event goes to every socket; each socket must read
exactly what it should, then the probe (so a socket that heard something extra, or missed
something, fails instead of hanging).
"""

from __future__ import annotations

import contextlib
import functools
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from starlette.websockets import WebSocketDisconnect

from app import live_events
from app.events_hub import hub as events_hub
from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.moderation import ModerationEvent
from app.models.request import ConversationRequest
from app.models.user import User
from app.routers import events as events_router
from app.security import issue_listener_token, issue_session_token
from app.services import request_visibility, stream
from app.services.paths_data import COMMUNITIES

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres

API = "/api/v1"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )
    monkeypatch.setattr(stream, "post_message", lambda *a, **k: None)
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, conversations, conversation_requests, "
                "request_passes, moderation_events CASCADE"
            )
        )
        s.commit()
    yield


_OPEN: list = []  # every Sock a test opened; closed before the TestClient shuts down


@pytest.fixture
def client():
    with TestClient(app) as c:
        try:
            yield c
        finally:
            # A socket left open (a failed assertion, or one the server closed) would make the
            # TestClient's shutdown wait for it forever.
            while _OPEN:
                _OPEN.pop().close()


def _member(s, community="upsc") -> str:
    u = User(
        persona_name="Quiet Cove",
        persona_avatar="x",
        dob=date(1996, 1, 1),
        age_at_signup=30,
        community_slug=community,
        journey_stage=next(iter(COMMUNITIES[community]["stages"])),
    )
    s.add(u)
    s.flush()
    return u.id


def _mentor(s, name="Open River", *, certified=True, vetting=VettingStatus.approved) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="seed",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=vetting,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
        certified_exam=certified,
    )
    s.add(li)
    s.flush()
    return li.id


def _auth(uid):
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _lauth(lid):
    return {"Authorization": f"Bearer {issue_listener_token(lid)}"}


class Sock:
    """One events socket: connect, authenticate, read hello."""

    def __init__(self, client, role, ident):
        self.role, self.ident = role, ident
        self._cm = client.websocket_connect(f"{API}/events")
        self.ws = self._cm.__enter__()
        self._open = True
        _OPEN.append(self)
        token = issue_session_token(ident) if role == "member" else issue_listener_token(ident)
        self.ws.send_json({"t": "auth", "token": token, "role": role})
        assert self.ws.receive_json() == {"t": "hello"}

    def until_probe(self) -> list[dict]:
        """Everything this socket heard before the probe."""
        live_events.publish(
            members=[self.ident] if self.role == "member" else [],
            listeners=[self.ident] if self.role == "listener" else [],
            ev={"t": "probe"},
        )
        got = []
        for _ in range(20):
            frame = self.ws.receive_json()
            if frame == {"t": "probe"}:
                return got
            got.append(frame)
        raise AssertionError("no probe")

    def close(self):
        if self._open:
            self._open = False
            with contextlib.suppress(Exception):
                self._cm.__exit__(None, None, None)


def _closed_with(ws) -> int:
    with pytest.raises(WebSocketDisconnect) as e:
        ws.receive_json()
    return e.value.code


# ---- auth ---------------------------------------------------------------------------------


def test_member_and_mentor_authenticate_and_get_hello(client):
    with TestSession() as s:
        m, li = _member(s), _mentor(s)
        s.commit()
    a, b = Sock(client, "member", m), Sock(client, "listener", li)
    assert a.until_probe() == [] and b.until_probe() == []
    a.close()
    b.close()


@pytest.mark.parametrize(
    "frame",
    [
        {"t": "auth", "token": "nonsense", "role": "member"},
        {"t": "auth", "role": "member"},
        {"t": "hello", "token": "x", "role": "member"},
        {"t": "auth", "token": None, "role": "admin"},
    ],
)
def test_bad_auth_is_closed_4401(client, frame):
    with client.websocket_connect(f"{API}/events") as ws:
        ws.send_json(frame)
        assert _closed_with(ws) == 4401


def test_a_token_for_the_other_role_is_refused(client):
    with TestSession() as s:
        m, li = _member(s), _mentor(s)
        s.commit()
    with client.websocket_connect(f"{API}/events") as ws:
        ws.send_json({"t": "auth", "token": issue_session_token(m), "role": "listener"})
        assert _closed_with(ws) == 4401
    with client.websocket_connect(f"{API}/events") as ws:
        ws.send_json({"t": "auth", "token": issue_listener_token(li), "role": "member"})
        assert _closed_with(ws) == 4401


def test_a_suspended_mentor_is_refused(client):
    with TestSession() as s:
        li = _mentor(s, vetting=VettingStatus.suspended)
        s.commit()
    with client.websocket_connect(f"{API}/events") as ws:
        ws.send_json({"t": "auth", "token": issue_listener_token(li), "role": "listener"})
        assert _closed_with(ws) == 4401


def test_no_auth_in_time_is_closed_4401(client, monkeypatch):
    monkeypatch.setattr(events_router, "AUTH_TIMEOUT_S", 0.2)
    with client.websocket_connect(f"{API}/events") as ws:
        assert _closed_with(ws) == 4401


def test_a_frame_over_1kb_closes_1009(client):
    with TestSession() as s:
        m = _member(s)
        s.commit()
    sock = Sock(client, "member", m)
    sock.ws.send_text("x" * 2000)
    assert _closed_with(sock.ws) == 1009


def test_a_fourth_socket_replaces_the_oldest(client):
    with TestSession() as s:
        m = _member(s)
        s.commit()
    socks = [Sock(client, "member", m) for _ in range(4)]
    assert _closed_with(socks[0].ws) == 4409
    for sock in socks[1:]:
        assert sock.until_probe() == []
    for sock in socks[1:]:
        sock.close()


# ---- producers ----------------------------------------------------------------------------


def test_a_personal_request_reaches_only_its_mentor_and_the_answer_reaches_the_member(client):
    with TestSession() as s:
        m, other_m = _member(s), _member(s)
        target, other = _mentor(s, "Open River"), _mentor(s, "Still Lake")
        s.commit()
    sm, so_m = Sock(client, "member", m), Sock(client, "member", other_m)
    st, so = Sock(client, "listener", target), Sock(client, "listener", other)

    r = client.post(
        f"{API}/listeners/{target}/request", json={"intro_message": "hi"}, headers=_auth(m)
    )
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    assert st.until_probe() == [{"t": "request.new", "id": rid}]
    assert so.until_probe() == [] and sm.until_probe() == [] and so_m.until_probe() == []

    r = client.post(f"{API}/listener/me/requests/{rid}/accept", headers=_lauth(target))
    assert r.status_code == 200, r.text
    cid = r.json()["conversation_id"]
    member_heard = sm.until_probe()
    assert {"t": "request.changed", "id": rid, "status": "matched"} in member_heard
    assert {"t": "conversation.changed", "id": cid} in member_heard
    mentor_heard = st.until_probe()
    assert {"t": "conversation.changed", "id": cid} in mentor_heard
    assert {"t": "request.gone", "id": rid} in mentor_heard
    assert so.until_probe() == [] and so_m.until_probe() == []
    for sock in (sm, so_m, st, so):
        sock.close()


def test_a_declined_and_a_withdrawn_request(client):
    with TestSession() as s:
        m, target = _member(s), _mentor(s)
        s.commit()
    sm, st = Sock(client, "member", m), Sock(client, "listener", target)
    rid = client.post(
        f"{API}/listeners/{target}/request", json={"intro_message": "hi"}, headers=_auth(m)
    ).json()["id"]
    assert st.until_probe() == [{"t": "request.new", "id": rid}]
    client.post(f"{API}/listener/me/requests/{rid}/decline", headers=_lauth(target))
    assert sm.until_probe() == [{"t": "request.changed", "id": rid, "status": "declined"}]
    assert st.until_probe() == [{"t": "request.gone", "id": rid}]

    rid2 = client.post(
        f"{API}/listeners/{target}/request", json={"intro_message": "again"}, headers=_auth(m)
    ).json()["id"]
    assert st.until_probe() == [{"t": "request.new", "id": rid2}]
    client.delete(f"{API}/listeners/requests/{rid2}", headers=_auth(m))
    assert sm.until_probe() == [{"t": "request.changed", "id": rid2, "status": "expired"}]
    assert st.until_probe() == [{"t": "request.gone", "id": rid2}]
    sm.close()
    st.close()


def test_a_broadcast_reaches_exactly_its_audience_and_leaves_when_taken(client):
    with TestSession() as s:
        m = _member(s)
        a, b = _mentor(s, "A", certified=True), _mentor(s, "B", certified=True)
        peer = _mentor(s, "Peer", certified=False)
        blocked = _mentor(s, "Blocked", certified=True)
        s.add(ModerationEvent(reporter_id=m, subject_id=blocked, blocked=True))
        s.commit()
    socks = {
        k: Sock(client, "listener", v)
        for k, v in dict(a=a, b=b, peer=peer, blocked=blocked).items()
    }

    r = client.post(f"{API}/match/ask", json={"audience": "in_service"}, headers=_auth(m))
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    assert socks["a"].until_probe() == [{"t": "request.new", "id": rid}]
    assert socks["b"].until_probe() == [{"t": "request.new", "id": rid}]
    assert socks["peer"].until_probe() == [] and socks["blocked"].until_probe() == []

    assert (
        client.post(f"{API}/listener/me/requests/{rid}/accept", headers=_lauth(a)).status_code
        == 200
    )
    assert socks["b"].until_probe() == [{"t": "request.gone", "id": rid}]
    heard_by_a = socks["a"].until_probe()
    assert {"t": "request.gone", "id": rid} in heard_by_a
    assert any(e["t"] == "conversation.changed" for e in heard_by_a)
    assert socks["peer"].until_probe() == [] and socks["blocked"].until_probe() == []
    for sock in socks.values():
        sock.close()


def test_passing_on_a_broadcast_tells_only_the_mentor_who_passed(client):
    with TestSession() as s:
        m, a, b = _member(s), _mentor(s, "A"), _mentor(s, "B")
        s.commit()
    sa, sb = Sock(client, "listener", a), Sock(client, "listener", b)
    rid = client.post(f"{API}/match/ask", json={}, headers=_auth(m)).json()["id"]
    assert sa.until_probe() == [{"t": "request.new", "id": rid}]
    assert sb.until_probe() == [{"t": "request.new", "id": rid}]
    client.post(f"{API}/listener/me/requests/{rid}/decline", headers=_lauth(a))
    assert sa.until_probe() == [{"t": "request.gone", "id": rid}]
    assert sb.until_probe() == []
    sa.close()
    sb.close()


def test_ending_and_snoozing_tell_the_right_sides(client):
    with TestSession() as s:
        m, li, other = _member(s), _mentor(s), _mentor(s, "Other")
        c = Conversation(
            type="anon",
            status=ConversationStatus.active,
            user_id=m,
            listener_id=li,
            chat_backend="own",
        )
        s.add(c)
        s.flush()
        c.stream_channel_id = c.id
        cid = c.id
        s.commit()
    sm, sl, so = (
        Sock(client, "member", m),
        Sock(client, "listener", li),
        Sock(client, "listener", other),
    )
    assert (
        client.post(f"{API}/listener/me/conversations/{cid}/snooze", headers=_lauth(li)).status_code
        == 200
    )
    assert sl.until_probe() == [{"t": "conversation.changed", "id": cid}]
    assert sm.until_probe() == []  # a snooze is the mentor's own business
    assert (
        client.post(f"{API}/listener/me/conversations/{cid}/end", headers=_lauth(li)).status_code
        == 200
    )
    assert sm.until_probe() == [{"t": "conversation.changed", "id": cid}]
    assert sl.until_probe() == [{"t": "conversation.changed", "id": cid}]
    assert so.until_probe() == []
    for sock in (sm, sl, so):
        sock.close()


def test_review_decided_reaches_the_mentor_whose_document_it_was(client):
    with TestSession() as s:
        li, other = _mentor(s, "Doc", certified=False), _mentor(s, "Other")
        s.commit()
    sl, so = Sock(client, "listener", li), Sock(client, "listener", other)
    with TestSession() as s:
        live_events.review_decided(s, listener_id=li)
        s.commit()
    assert sl.until_probe() == [{"t": "review.decided"}]
    assert so.until_probe() == []
    sl.close()
    so.close()


# ---- the own-chat `state` frame ------------------------------------------------------------


def test_the_member_chat_socket_hears_the_exam_suggestion_and_the_end(client):
    with TestSession() as s:
        m, li = _member(s), _mentor(s, certified=False)
        c = Conversation(
            type="anon",
            status=ConversationStatus.active,
            user_id=m,
            listener_id=li,
            chat_backend="own",
        )
        s.add(c)
        s.flush()
        c.stream_channel_id = c.id
        cid = c.id
        s.commit()
    with client.websocket_connect(f"{API}/chat/ws/{cid}") as ws:
        ws.send_json({"t": "hello", "token": issue_session_token(m), "after": 0})
        assert ws.receive_json()["t"] == "hello"
        r = client.post(
            f"{API}/listener/me/conversations/{cid}/suggest-certified", headers=_lauth(li)
        )
        assert r.status_code == 200, r.text
        frames = [ws.receive_json() for _ in range(1)]
        assert {"t": "state", "exam_redirect": True, "status": "active"} in frames
        client.post(f"{API}/listener/me/conversations/{cid}/end", headers=_lauth(li))
        seen = []
        while not seen or seen[-1]["t"] != "ended":
            seen.append(ws.receive_json())
        kinds = [f["t"] for f in seen if f["t"] in ("state", "ended")]
        assert kinds == ["state", "ended"]
        assert {"t": "state", "exam_redirect": True, "status": "ended"} in seen


# ---- after commit, never before ------------------------------------------------------------


def test_events_go_out_only_when_the_transaction_commits(monkeypatch):
    sent = []
    monkeypatch.setattr(live_events, "publish", lambda **kw: sent.append(kw))
    with TestSession() as s:
        s.execute(text("SELECT 1"))  # a producer always emits inside a begun transaction
        live_events.emit(s, members=["x"], ev={"t": "conversation.changed", "id": "c1"})
        s.rollback()
        assert sent == []
        live_events.emit(s, members=["x"], ev={"t": "conversation.changed", "id": "c2"})
        assert sent == []
        s.commit()
    assert sent == [
        {"members": ["x"], "listeners": [], "ev": {"t": "conversation.changed", "id": "c2"}}
    ]


def test_a_publish_failure_never_fails_the_caller(monkeypatch):
    def boom(_payload):
        raise RuntimeError("valkey on fire")

    monkeypatch.setattr(events_hub, "publish_sync", boom)
    live_events.publish(members=["x"], ev={"t": "probe"})  # no exception


# ---- Valkey down: the process still delivers to its own sockets -----------------------------


def test_without_valkey_events_still_reach_this_process_sockets(client):
    with TestSession() as s:
        m, target = _member(s), _mentor(s)
        s.commit()
    st = Sock(client, "listener", target)
    saved = events_hub._redis
    events_hub._redis = None
    try:
        rid = client.post(
            f"{API}/listeners/{target}/request", json={"intro_message": "hi"}, headers=_auth(m)
        ).json()["id"]
        assert st.ws.receive_json() == {"t": "request.new", "id": rid}
    finally:
        events_hub._redis = saved
    st.close()


# ---- presence: the open app is the heartbeat -------------------------------------------------


def test_connecting_and_the_sweep_touch_presence_and_the_sweep_drops_lost_standing(client):
    with TestSession() as s:
        li = _mentor(s)
        s.commit()
    sock = Sock(client, "listener", li)
    with TestSession() as s:
        first = s.get(ListenerProfile, li).last_seen_at
        assert first is not None  # connecting counted as a heartbeat
        s.execute(text("UPDATE listener_profiles SET last_seen_at = now() - interval '10 minutes'"))
        s.commit()
    client.portal.call(functools.partial(events_hub.sweep, force_touch=True))
    with TestSession() as s:
        touched = s.get(ListenerProfile, li).last_seen_at
        assert touched is not None and touched > first.replace(year=first.year - 1)
        stale = s.scalar(
            select(text("count(*)"))
            .select_from(ListenerProfile)
            .where(ListenerProfile.last_seen_at < text("now() - interval '5 minutes'"))
        )
        assert stale == 0
        s.execute(
            text("UPDATE listener_profiles SET vetting_status = 'suspended' WHERE id = :i"),
            {"i": li},
        )
        s.commit()
    client.portal.call(functools.partial(events_hub.sweep, force_touch=True))
    assert _closed_with(sock.ws) == 4403


# ---- one rule: the inbox listing and the event recipients agree ------------------------------


def test_recipients_are_exactly_the_mentors_whose_inbox_lists_it(client):
    with TestSession() as s:
        m = _member(s)
        mentors = {
            "cert": _mentor(s, "Cert", certified=True),
            "peer": _mentor(s, "Peer", certified=False),
            "cert_blocked": _mentor(s, "CB", certified=True),
            "peer2": _mentor(s, "Peer2", certified=False),
        }
        s.add(ModerationEvent(reporter_id=m, subject_id=mentors["cert_blocked"], blocked=True))
        s.commit()
    asked = {}
    for audience in ("any", "in_service", "peer"):
        with TestSession() as s:  # one open broadcast at a time per member: close the last one
            s.execute(text("UPDATE conversation_requests SET status = 'expired'"))
            s.commit()
        r = client.post(f"{API}/match/ask", json={"audience": audience}, headers=_auth(m))
        assert r.status_code == 200, r.text
        asked[audience] = r.json()["id"]
        with TestSession() as s:
            s.execute(
                text("UPDATE conversation_requests SET status = 'pending' WHERE id = :i"),
                {"i": asked[audience]},
            )
            s.commit()
    personal = client.post(
        f"{API}/listeners/{mentors['peer2']}/request",
        json={"intro_message": "hi"},
        headers=_auth(m),
    )
    assert personal.status_code == 200, personal.text
    asked["personal"] = personal.json()["id"]
    with TestSession() as s:
        s.execute(text("UPDATE conversation_requests SET status = 'pending'"))
        s.commit()
    listed = {
        lid: {
            row["id"]
            for row in client.get(
                f"{API}/listener/me/requests?limit=50", headers=_lauth(lid)
            ).json()
        }
        for lid in mentors.values()
    }
    with TestSession() as s:
        for rid in asked.values():
            req = s.get(ConversationRequest, rid)
            expected = {lid for lid, ids in listed.items() if rid in ids}
            assert set(request_visibility.recipient_ids(s, req)) == expected, rid


# ---- additions for the app side: pong seq, review to the member, mentor presence -------------


def _own_chat(s, m, li) -> str:
    c = Conversation(
        type="anon", status=ConversationStatus.active, user_id=m, listener_id=li, chat_backend="own"
    )
    s.add(c)
    s.flush()
    c.stream_channel_id = c.id
    return c.id


def _next_of(ws, kind):
    for _ in range(10):
        f = ws.receive_json()
        if f["t"] == kind:
            return f
    raise AssertionError(f"no {kind}")


def test_pong_carries_the_newest_seq(client):
    with TestSession() as s:
        m, li = _member(s), _mentor(s)
        cid = _own_chat(s, m, li)
        s.commit()
    with client.websocket_connect(f"{API}/chat/ws/{cid}") as ws:
        ws.send_json({"t": "hello", "token": issue_session_token(m), "after": 0})
        assert ws.receive_json()["t"] == "hello"
        ws.send_json({"t": "ping"})
        assert _next_of(ws, "pong") == {"t": "pong", "last_seq": 0}
        ws.send_json({"t": "send", "client_id": "a1", "text": "hello"})
        _next_of(ws, "message")
        ws.send_json({"t": "ping"})
        assert _next_of(ws, "pong")["last_seq"] == 1


def test_review_decided_reaches_an_applicant_who_is_still_a_member(client):
    with TestSession() as s:
        m, other = _member(s), _member(s)
        s.commit()
    sm, so = Sock(client, "member", m), Sock(client, "member", other)
    with TestSession() as s:
        live_events.review_decided(s, member_id=m)
        s.commit()
    assert sm.until_probe() == [{"t": "review.decided"}]
    assert so.until_probe() == []
    sm.close()
    so.close()


def test_a_mentor_going_away_tells_the_members_of_their_active_chats_only(client):
    with TestSession() as s:
        m, ended_m, stranger = _member(s), _member(s), _member(s)
        li = _mentor(s)
        cid = _own_chat(s, m, li)
        s.add(
            Conversation(
                type="anon", status=ConversationStatus.ended, user_id=ended_m, listener_id=li
            )
        )
        s.commit()
    sm, se, ss = (Sock(client, "member", x) for x in (m, ended_m, stranger))
    r = client.patch(f"{API}/listener/me/status", json={"status": "away"}, headers=_lauth(li))
    assert r.status_code == 200, r.text
    assert sm.until_probe() == [{"t": "conversation.changed", "id": cid}]
    assert se.until_probe() == [] and ss.until_probe() == []
    # The same status again changes nothing and says nothing.
    client.patch(f"{API}/listener/me/status", json={"status": "away"}, headers=_lauth(li))
    assert sm.until_probe() == []
    for sock in (sm, se, ss):
        sock.close()


def test_the_stale_presence_sweep_tells_the_members_too(client):
    from app.services import matching

    with TestSession() as s:
        m, li = _member(s), _mentor(s)
        cid = _own_chat(s, m, li)
        s.execute(
            text(
                "UPDATE listener_profiles SET last_seen_at = now() - interval '1 hour' WHERE id = :i"
            ),
            {"i": li},
        )
        s.commit()
    sm = Sock(client, "member", m)
    with TestSession() as s:
        assert matching.sweep_stale_presence(s) == 1
        s.commit()
    assert sm.until_probe() == [{"t": "conversation.changed", "id": cid}]
    sm.close()
