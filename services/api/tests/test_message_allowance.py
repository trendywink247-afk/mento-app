"""Member message allowance (DECISIONS §L.2): 3 in a row, 10 a day — AFTER the scan.

The ordering is the safety property and gets the first tests: a crisis-flagged
message over either limit is delivered with its helpline card, is never held and is
never counted; a conversation that raised a flag recently is exempt as a whole.
Then: both limits, the mentor exemption + streak reset, the IST day boundary,
fail-open, the rollout switch, retry dedupe, member scoping and admin scoping.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from app.config import get_settings
from app.main import app
from app.models.admin import AdminAccount, AdminAuditLog
from app.models.allowance import MessageAllowanceDay
from app.models.conversation import Conversation
from app.models.enums import AdminRole, ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.safety import SafetyFlag
from app.models.user import User
from app.routers import stream_hooks
from app.security import issue_admin_token, issue_listener_token, issue_session_token
from app.services import allowance, stream

from .conftest import TestSession, requires_postgres

BEFORE = "/api/v1/stream/before-message-send"
CRISIS_TEXT = "honestly I want to die"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(stream, "verify_webhook", lambda body, sig: True)
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def enforced(monkeypatch):
    monkeypatch.setattr(get_settings(), "allowance_enforced", True)


def _pair(s, *, name: str = "Gentle Harbor") -> tuple[str, str, str, str]:
    """member id, listener id, conversation id, channel id."""
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    li = ListenerProfile(
        persona_name="Steady Cedar",
        persona_avatar="owl",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
    )
    s.add_all([u, li])
    s.flush()
    channel = f"ch-{uuid.uuid4().hex[:12]}"
    c = Conversation(
        user_id=u.id,
        listener_id=li.id,
        status=ConversationStatus.active,
        stream_channel_id=channel,
    )
    s.add(c)
    s.commit()
    return u.id, li.id, c.id, channel


def _send(client, channel: str, sender: str, text: str = "and another thing") -> dict:
    r = client.post(
        BEFORE,
        json={
            "message": {"id": f"m-{uuid.uuid4().hex}", "text": text},
            "user": {"id": sender},
            "channel": {"id": channel},
        },
    )
    assert r.status_code == 200
    return r.json()


def _held(body: dict) -> str | None:
    msg = body.get("message") or {}
    return msg.get("allowance", {}).get("reason") if msg.get("type") == "error" else None


def _day(user_id: str) -> MessageAllowanceDay | None:
    with TestSession() as s:
        return s.get(
            MessageAllowanceDay, {"user_id": user_id, "day": allowance.ist_day(datetime.now(UTC))}
        )


def _streak(convo_id: str) -> int:
    with TestSession() as s:
        return s.get(Conversation, convo_id).member_streak


# --- the ordering property -------------------------------------------------------


@requires_postgres
def test_crisis_message_over_the_in_a_row_limit_is_delivered_and_not_counted(
    client, db_session, enforced
):
    member, _li, convo, channel = _pair(db_session)
    for _ in range(3):
        assert _held(_send(client, channel, member)) is None
    assert _held(_send(client, channel, member)) == "in_a_row"  # the 4th is held…

    body = _send(client, channel, member, CRISIS_TEXT)  # …but never THIS one
    assert body["message"].get("type") != "error"
    assert body["message"]["crisis"]["signal"] == "suicidal"
    assert any(h["number"] == "14416" for h in body["message"]["crisis"]["helplines"])
    assert body["message"]["text"] == CRISIS_TEXT
    assert "allowance" not in body["message"]

    row = _day(member)
    assert row.sent == 3  # the crisis message was not counted
    assert row.crisis_exempt == 1
    assert _streak(convo) == 3  # nor did it lengthen the run


@requires_postgres
def test_crisis_message_over_the_daily_limit_is_delivered_and_not_counted(
    client, db_session, enforced
):
    member, _li, _convo, channel = _pair(db_session)
    with TestSession() as s:
        s.add(
            MessageAllowanceDay(user_id=member, day=allowance.ist_day(datetime.now(UTC)), sent=10)
        )
        s.commit()
    assert _held(_send(client, channel, member)) == "daily"
    body = _send(client, channel, member, CRISIS_TEXT)
    assert body["message"]["crisis"]["signal"] == "suicidal"
    assert body["message"].get("type") != "error"
    assert _day(member).sent == 10


@requires_postgres
def test_crisis_message_is_delivered_even_without_the_conversation_exemption(
    client, db_session, enforced, monkeypatch
):
    """The message-level guarantee stands on its own: with the conversation-wide
    exemption switched off, a flagged message over the limit still goes through."""
    monkeypatch.setattr(get_settings(), "allowance_crisis_exempt_hours", 0)
    member, _li, convo, channel = _pair(db_session)
    for _ in range(4):
        _send(client, channel, member)
    body = _send(client, channel, member, CRISIS_TEXT)
    assert body["message"].get("type") != "error"
    assert body["message"]["crisis"]["signal"] == "suicidal"
    assert _day(member).sent == 3
    assert _streak(convo) == 3
    assert _held(_send(client, channel, member)) == "in_a_row"  # ordinary ones still wait


@requires_postgres
def test_a_recently_flagged_conversation_is_exempt_as_a_whole(client, db_session, enforced):
    """The kinder reading of "a message (or conversation)": after something
    frightening, the follow-ups are not rationed either."""
    member, _li, convo, channel = _pair(db_session)
    _send(client, channel, member, CRISIS_TEXT)
    for _ in range(6):
        assert _held(_send(client, channel, member, "i don't know what to do")) is None
    row = _day(member)
    assert row.sent == 0
    assert row.crisis_exempt == 7
    assert _streak(convo) == 0

    # …and the exemption runs out: an old flag no longer lifts the limits.
    with TestSession() as s:
        flag = s.execute(select(SafetyFlag).where(SafetyFlag.conversation_id == convo)).scalar_one()
        flag.created_at = datetime.now(UTC) - timedelta(hours=25)
        s.commit()
    for _ in range(3):
        assert _held(_send(client, channel, member)) is None
    assert _held(_send(client, channel, member)) == "in_a_row"


@requires_postgres
def test_the_scan_runs_before_the_allowance(client, db_session, enforced, monkeypatch):
    """Structural proof of the order: the allowance is never consulted for a message
    the scan flagged."""
    member, _li, _convo, channel = _pair(db_session)
    calls: list[str] = []
    real = allowance.register

    def _spy(db, **kw):
        calls.append(kw["sender_id"])
        return real(db, **kw)

    monkeypatch.setattr(allowance, "register", _spy)
    _send(client, channel, member, CRISIS_TEXT)
    assert calls == []
    _send(client, channel, member, "ordinary")
    assert calls == [member]


# --- the two limits --------------------------------------------------------------


@requires_postgres
def test_three_in_a_row_then_held_until_the_mentor_replies(client, db_session, enforced):
    member, mentor, convo, channel = _pair(db_session)
    for _ in range(3):
        assert _send(client, channel, member) == {}
    body = _send(client, channel, member, "my private words")
    msg = body["message"]
    assert msg["type"] == "error"  # Stream's rejection contract
    assert msg["allowance"] == {
        "held": True,
        "reason": "in_a_row",
        "in_a_row": 3,
        "in_a_row_limit": 3,
        "left_today": 7,
        "daily_limit": 10,
        "resets_at": msg["allowance"]["resets_at"],
    }
    assert "three in a row" in msg["text"]
    assert "my private words" not in str(body)  # never echo the member's text
    row = _day(member)
    assert (row.sent, row.row_cap_hits, row.day_cap_hits) == (3, 1, 0)

    assert _send(client, channel, mentor, "I'm here.") == {}  # the mentor replies
    assert _streak(convo) == 0
    assert _send(client, channel, member) == {}  # and the member may write again
    assert _day(member).sent == 4


@requires_postgres
def test_ten_a_day_across_conversations(client, db_session, enforced):
    member, mentor, _convo, channel = _pair(db_session)
    li2 = ListenerProfile(
        persona_name="Quiet Banyan",
        persona_avatar="x",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
    )
    db_session.add(li2)
    db_session.flush()
    db_session.add(
        Conversation(
            user_id=member,
            listener_id=li2.id,
            status=ConversationStatus.active,
            stream_channel_id="ch-second",
        )
    )
    db_session.commit()

    sent = 0
    while sent < 10:  # alternate threads, the mentor answering so only the day counts
        ch, who = (channel, mentor) if sent % 2 == 0 else ("ch-second", li2.id)
        assert _send(client, ch, member) == {}
        _send(client, ch, who, "reply")
        sent += 1
    body = _send(client, channel, member)
    assert _held(body) == "daily"
    assert body["message"]["allowance"]["left_today"] == 0
    assert "today" in body["message"]["text"]
    row = _day(member)
    assert (row.sent, row.day_cap_hits, row.reached_day_cap) == (10, 1, True)


@requires_postgres
def test_mentor_messages_are_never_limited(client, db_session, enforced):
    member, mentor, _convo, channel = _pair(db_session)
    for _ in range(25):
        assert _send(client, channel, mentor, "take your time") == {}
    with TestSession() as s:
        assert s.execute(select(func.count()).select_from(MessageAllowanceDay)).scalar_one() == 0


@requires_postgres
def test_the_day_resets_at_midnight_ist(db_session, enforced):
    member, _li, _convo, channel = _pair(db_session)
    # 18:29 UTC = 23:59 IST on the 1st; 18:31 UTC = 00:01 IST on the 2nd.
    late = datetime(2026, 3, 1, 18, 29, tzinfo=UTC)
    early = datetime(2026, 3, 1, 18, 31, tzinfo=UTC)
    assert allowance.ist_day(late) == date(2026, 3, 1)
    assert allowance.ist_day(early) == date(2026, 3, 2)
    assert allowance.resets_at(late) == datetime(2026, 3, 1, 18, 30, tzinfo=UTC)

    with TestSession() as s:
        s.add(MessageAllowanceDay(user_id=member, day=date(2026, 3, 1), sent=10))
        s.commit()
    with TestSession() as s:
        assert allowance.register(s, channel_id=channel, sender_id=member, now=late).held == "daily"
    with TestSession() as s:
        verdict = allowance.register(s, channel_id=channel, sender_id=member, now=early)
    assert verdict.held is None
    assert (verdict.state.sent_today, verdict.state.left_today) == (1, 9)


@requires_postgres
def test_old_rows_are_pruned_when_a_member_starts_a_new_day(db_session):
    member, _li, _convo, channel = _pair(db_session)
    now = datetime(2026, 3, 1, 6, 0, tzinfo=UTC)
    with TestSession() as s:
        s.add(MessageAllowanceDay(user_id=member, day=date(2026, 1, 1), sent=4))
        s.add(MessageAllowanceDay(user_id=member, day=date(2026, 2, 20), sent=2))
        s.commit()
    with TestSession() as s:
        allowance.register(s, channel_id=channel, sender_id=member, now=now)
    with TestSession() as s:
        days = s.scalars(select(MessageAllowanceDay.day).order_by(MessageAllowanceDay.day)).all()
    assert days == [date(2026, 2, 20), date(2026, 3, 1)]


# --- fail-open, the switch, retries ----------------------------------------------


def _db_down(*_a, **_k):
    raise OperationalError("SELECT 1", {}, Exception("connection refused"))


@requires_postgres
def test_fail_open_when_the_counter_store_is_unreachable(client, db_session, enforced, monkeypatch):
    member, _li, _convo, channel = _pair(db_session)
    for _ in range(3):
        _send(client, channel, member)
    monkeypatch.setattr(stream_hooks, "SessionLocal", _db_down)
    assert _send(client, channel, member) == {}  # over the limit, database down → delivered


@requires_postgres
def test_fail_open_when_the_counter_store_is_too_slow(client, db_session, enforced, monkeypatch):
    member, _li, _convo, channel = _pair(db_session)
    monkeypatch.setattr(get_settings(), "allowance_budget_ms", 50)

    def _slow(**_kw):
        import time

        time.sleep(0.4)
        return allowance.Verdict(held="in_a_row", state=None)  # type: ignore[arg-type]

    monkeypatch.setattr(stream_hooks, "_allowance_event", _slow)
    assert _send(client, channel, member) == {}


@requires_postgres
def test_redaction_still_runs_on_a_counted_message(client, db_session, enforced):
    member, _li, _convo, channel = _pair(db_session)
    body = _send(client, channel, member, "call me on 9876543210")
    assert body["message"]["moderation"]["redacted"] is True
    assert "9876543210" not in body["message"]["text"]
    assert _day(member).sent == 1


@requires_postgres
def test_counting_without_holding_while_the_switch_is_off(client, db_session):
    """The rollout default: the meter and the admin numbers work, nothing is held."""
    member, _li, convo, channel = _pair(db_session)
    for _ in range(12):
        assert _send(client, channel, member) == {}
    row = _day(member)
    assert (row.sent, row.row_cap_hits, row.day_cap_hits) == (12, 0, 0)
    r = client.get(
        f"/api/v1/conversations/{convo}/allowance",
        headers={"Authorization": f"Bearer {issue_session_token(member)}"},
    )
    assert r.json()["left_today"] == 0
    assert r.json()["can_send"] is True
    assert r.json()["enforced"] is False


@requires_postgres
def test_kill_switch_skips_the_allowance_entirely(client, db_session, enforced, monkeypatch):
    monkeypatch.setattr(get_settings(), "allowance_enabled", False)
    member, _li, _convo, channel = _pair(db_session)
    for _ in range(5):
        assert _send(client, channel, member) == {}
    assert _day(member) is None


@requires_postgres
def test_a_retried_hook_attempt_is_not_counted_twice(client, db_session, enforced):
    member, _li, convo, channel = _pair(db_session)
    payload = {
        "message": {"id": f"m-{uuid.uuid4().hex}", "text": "once"},
        "user": {"id": member},
        "channel": {"id": channel},
    }
    assert client.post(BEFORE, json=payload).json() == {}
    assert client.post(BEFORE, json=payload).json() == {}
    assert _day(member).sent == 1
    assert _streak(convo) == 1


@requires_postgres
def test_unknown_channel_and_stranger_are_left_alone(client, db_session, enforced):
    _member, _li, _convo, channel = _pair(db_session)
    for _ in range(5):
        assert _send(client, "no-such-channel", "someone") == {}
        assert _send(client, channel, "not-in-this-chat") == {}


# --- the member's own state -------------------------------------------------------


def _auth(user_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


@requires_postgres
def test_member_reads_their_allowance(client, db_session, enforced):
    member, mentor, convo, channel = _pair(db_session)
    fresh = client.get(f"/api/v1/conversations/{convo}/allowance", headers=_auth(member)).json()
    assert (fresh["in_a_row"], fresh["left_today"], fresh["can_send"]) == (0, 10, True)
    assert fresh["held_reason"] is None
    reset = datetime.fromisoformat(fresh["resets_at"])
    assert reset > datetime.now(UTC)
    assert reset.astimezone(allowance.IST).strftime("%H:%M") == "00:00"

    for _ in range(3):
        _send(client, channel, member)
    held = client.get(f"/api/v1/conversations/{convo}/allowance", headers=_auth(member)).json()
    assert (held["in_a_row"], held["in_a_row_limit"]) == (3, 3)
    assert (held["sent_today"], held["left_today"], held["daily_limit"]) == (3, 7, 10)
    assert (held["can_send"], held["held_reason"]) == (False, "in_a_row")

    daily = client.get("/api/v1/me/allowance", headers=_auth(member)).json()
    assert (daily["in_a_row"], daily["left_today"], daily["can_send"]) == (0, 7, True)

    _send(client, channel, mentor, "here")
    again = client.get(f"/api/v1/conversations/{convo}/allowance", headers=_auth(member)).json()
    assert (again["in_a_row"], again["can_send"]) == (0, True)


@requires_postgres
def test_allowance_is_scoped_to_the_member(client, db_session):
    member, mentor, convo, _channel = _pair(db_session)
    other, _l2, _c2, _ch2 = _pair(db_session, name="Someone Else")
    url = f"/api/v1/conversations/{convo}/allowance"
    assert client.get(url, headers=_auth(other)).status_code == 404
    assert client.get(url).status_code in (401, 403)
    mentor_token = {"Authorization": f"Bearer {issue_listener_token(mentor)}"}
    assert client.get(url, headers=mentor_token).status_code == 401
    assert client.get("/api/v1/me/allowance", headers=mentor_token).status_code == 401


# --- admin: numbers only ----------------------------------------------------------


def _admin(s, role=AdminRole.helper) -> dict:
    a = AdminAccount(name="Helper", role=role)
    s.add(a)
    s.commit()
    return {"Authorization": f"Bearer {issue_admin_token(a.id)}"}


@requires_postgres
def test_admin_counts_are_numbers_only_and_audited(client, db_session, enforced):
    member, mentor, convo, channel = _pair(db_session)
    for _ in range(4):
        _send(client, channel, member)  # 3 sent + 1 pause
    _send(client, channel, member, CRISIS_TEXT)  # 1 crisis-exempt
    today = allowance.ist_day(datetime.now(UTC))
    with TestSession() as s:
        s.add(
            MessageAllowanceDay(
                user_id=mentor_member(s),
                day=today - timedelta(days=2),
                sent=10,
                day_cap_hits=2,
                reached_day_cap=True,
            )
        )
        s.commit()

    admin = _admin(db_session)
    r = client.get("/api/v1/admin/allowance", headers=admin)
    assert r.status_code == 200
    body = r.json()
    assert body["rule"] == {
        "in_a_row": 3,
        "per_day": 10,
        "enforced": True,
        "crisis_exempt_hours": 24,
        "timezone": "Asia/Kolkata",
    }
    assert len(body["days"]) == 14
    assert body["days"][-1] == {
        "day": today.isoformat(),
        "messages_sent": 3,
        "crisis_exempt_sends": 1,
        "in_a_row_pauses": 1,
        "members_paused_in_a_row": 1,
        "daily_cap_holds": 0,
        "members_reached_daily_cap": 0,
    }
    two_ago = body["days"][-3]
    assert (two_ago["messages_sent"], two_ago["daily_cap_holds"]) == (10, 2)
    assert two_ago["members_reached_daily_cap"] == 1
    assert body["days"][0]["messages_sent"] == 0  # zero-filled
    assert body["totals"]["messages_sent"] == 13

    raw = r.text
    for secret in (member, mentor, convo, channel, "Gentle Harbor", "Steady Cedar", "die"):
        assert secret not in raw

    with TestSession() as s:
        log = s.execute(
            select(AdminAuditLog).where(AdminAuditLog.action == "allowance.viewed")
        ).scalar_one()
    assert log.meta == {"days": 14}

    assert len(client.get("/api/v1/admin/allowance?days=30", headers=admin).json()["days"]) == 30
    assert client.get("/api/v1/admin/allowance?days=31", headers=admin).status_code == 422


def mentor_member(s) -> str:
    u = User(persona_name="Far Shore", persona_avatar="x", dob=date(1990, 1, 1), age_at_signup=36)
    s.add(u)
    s.flush()
    return u.id


@requires_postgres
def test_admin_allowance_refuses_everyone_else(client, db_session):
    member, mentor, _convo, _channel = _pair(db_session)
    url = "/api/v1/admin/allowance"
    assert client.get(url).status_code in (401, 403)
    assert client.get(url, headers=_auth(member)).status_code == 401
    listener = {"Authorization": f"Bearer {issue_listener_token(mentor)}"}
    assert client.get(url, headers=listener).status_code == 401

    revoked = AdminAccount(name="Gone", role=AdminRole.helper)
    db_session.add(revoked)
    db_session.commit()
    token = {"Authorization": f"Bearer {issue_admin_token(revoked.id)}"}
    assert client.get(url, headers=token).status_code == 200
    from app.models.enums import AdminStatus

    with TestSession() as s:
        s.get(AdminAccount, revoked.id).status = AdminStatus.revoked
        s.commit()
    assert client.get(url, headers=token).status_code == 403
