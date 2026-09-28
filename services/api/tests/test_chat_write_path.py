"""One write path (WS5 T5.2): `chat.send` is the only way a message is stored, and it
runs, in this order and nowhere else:

    member status check → crisis scan → allowance (skipped for flagged messages)
    → redaction → insert with seq → commit → publish → enqueue jobs

The first two tests are the plan's own (docs/superpowers/plans/2026-09-20-mento-program-
plan.md, T5.2); the rest pin each stage and the "one site" rule.
"""

from __future__ import annotations

import ast
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import func, select, text

from app.config import get_settings
from app.models.chat_message import ChatMessage
from app.models.enums import ConversationEndedBy, MemberStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.safety import SafetyFlag
from app.models.user import User
from app.services import chat, conversations

from .chat_helpers import seed_chat
from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres

APP_DIR = Path(__file__).resolve().parents[1] / "app"


def seed_conversation(db_session):
    """(member, conversation) — the plan's helper, over tests/chat_helpers.seed_chat."""
    seeded = seed_chat(db_session)
    return db_session.get(User, seeded.member_id), _Conv(seeded)


class _Conv:
    def __init__(self, seeded) -> None:
        self.id = seeded.cid
        self.seeded = seeded


@pytest.fixture(autouse=True)
def _no_fanout(monkeypatch):
    """Publishing is proven over sockets (test_chat_ws, test_chat_workers); here it is
    recorded so a test can see it happened, and when."""
    sent: list[tuple[str, dict]] = []
    monkeypatch.setattr(chat, "publish", lambda cid, event: sent.append((cid, event)))
    return sent


def _count(db, model) -> int:
    db.expire_all()
    return db.execute(select(func.count()).select_from(model)).scalar_one()


# ---- the plan's two tests ---------------------------------------------------------------


def test_scan_runs_before_persist(monkeypatch, db_session):
    member, conv = seed_conversation(db_session)
    order: list[str] = []
    monkeypatch.setattr(chat, "scan_message", lambda text: order.append("scan") or None)
    monkeypatch.setattr(chat, "persist_message", lambda *a, **k: order.append("persist") or 1)
    chat.send(db_session, member.id, conv.id, client_id="c1", body="hello")
    assert order == ["scan", "persist"]


def test_flagged_message_stores_signal_not_text(db_session):
    member, conv = seed_conversation(db_session)
    chat.send(db_session, member.id, conv.id, client_id="c2", body="I want to end my life")
    flag = db_session.execute(select(SafetyFlag)).scalar_one()
    assert flag.signal.value in ("suicidal", "self_harm")
    assert "end my life" not in (flag.matched_terms or "")


# ---- the whole order ----------------------------------------------------------------------


def test_every_stage_runs_once_in_the_plans_order(monkeypatch, db_session):
    member, conv = seed_conversation(db_session)
    order: list[str] = []

    def spy(name, fn):
        def wrapped(*a, **k):
            order.append(name)
            return fn(*a, **k)

        monkeypatch.setattr(chat, name, wrapped)

    for name in (
        "check_standing",
        "scan_message",
        "apply_allowance",
        "redact_text",
        "persist_message",
        "publish",
        "enqueue_after_send",
    ):
        spy(name, getattr(chat, name))

    sent = chat.send(db_session, member.id, conv.id, client_id="o1", body="a plain message")
    assert sent.message is not None
    assert order == [
        "check_standing",
        "scan_message",
        "apply_allowance",
        "redact_text",
        "persist_message",
        "check_standing",  # re-checked under the lock (session 48: closes the TOCTOU
        # window a Clean Wipe/End/ban/suspension could land in between the first check
        # and this insert) — a second call, not a second STAGE; the plan's stage order
        # is unchanged, this just makes the first check's answer still true at commit.
        "publish",
        "enqueue_after_send",
    ]


def test_a_wipe_between_the_standing_check_and_the_insert_wins(monkeypatch, db_session):
    """TOCTOU close (session 48): `send`'s check_standing runs BEFORE persist_message
    takes the conversation's row lock. If a Clean Wipe lands in that gap — a real race,
    since the wipe's own lock is fully released (committed) before a stalled sender's
    persist_message can acquire it — the send must still be refused under the lock, not
    insert a fresh body into an already-wiped conversation."""
    member, conv = seed_conversation(db_session)
    # Hooked at scan_message: right after check_standing/_prior, before apply_allowance
    # can take any lock of its own on this session's still-open transaction — a later
    # hook risks the wipe's separate session blocking on OUR uncommitted lock instead
    # of reproducing the race.
    real_scan = chat.scan_message

    def wipe_then_scan(text):
        with TestSession() as other:
            convo = conversations.lock(other, conv.id)
            conversations.clean_wipe(other, convo, ConversationEndedBy.member)
            other.commit()
        return real_scan(text)

    monkeypatch.setattr(chat, "scan_message", wipe_then_scan)

    with pytest.raises(chat.NotAllowed):
        chat.send(db_session, member.id, conv.id, client_id="w1", body="after the wipe?")

    assert _count(db_session, ChatMessage) == 0


def test_publish_happens_only_after_the_row_is_committed(monkeypatch, db_session, _no_fanout):
    member, conv = seed_conversation(db_session)
    seen_committed: list[int] = []

    def publish(cid, event):
        # A fresh connection sees only committed rows.
        from .conftest import TestSession

        with TestSession() as other:
            seen_committed.append(_count(other, ChatMessage))

    monkeypatch.setattr(chat, "publish", publish)
    chat.send(db_session, member.id, conv.id, client_id="p1", body="hi")
    assert seen_committed == [1]


# ---- crisis never meets the allowance ------------------------------------------------------


def test_a_crisis_message_is_never_held_or_counted(monkeypatch, db_session):
    monkeypatch.setattr(get_settings(), "allowance_enforced", True)
    member, conv = seed_conversation(db_session)
    for i in range(3):
        assert (
            chat.send(db_session, member.id, conv.id, client_id=f"a{i}", body=f"line {i}").held
            is None
        )
    held = chat.send(db_session, member.id, conv.id, client_id="a3", body="line 3")
    assert held.held is not None and held.message is None

    calls: list[str] = []
    real = chat.apply_allowance
    monkeypatch.setattr(chat, "apply_allowance", lambda *a, **k: calls.append("x") or real(*a, **k))
    sent = chat.send(db_session, member.id, conv.id, client_id="c1", body="i want to kill myself")
    assert sent.held is None and sent.message["crisis"]["signal"] == "suicidal"
    assert calls == []  # never even asked
    day = db_session.execute(text("SELECT sent, crisis_exempt FROM message_allowance_days")).one()
    assert day.sent == 3  # the crisis message was not counted
    assert _count(db_session, ChatMessage) == 4


# ---- standing -------------------------------------------------------------------------------


@pytest.mark.parametrize("status", [MemberStatus.suspended, MemberStatus.banned])
def test_a_suspended_or_banned_member_cannot_send(db_session, status, _no_fanout):
    member, conv = seed_conversation(db_session)
    member.status = status
    member.banned_until = datetime.now(UTC) + timedelta(days=1)
    db_session.commit()
    with pytest.raises(chat.NotAllowed) as refused:
        chat.send(db_session, member.id, conv.id, client_id="s1", body="i want to die")
    assert refused.value.code == f"member_{status.value}"
    assert _count(db_session, ChatMessage) == 0
    assert _no_fanout == []


def test_a_lapsed_suspension_sends_again(db_session):
    member, conv = seed_conversation(db_session)
    member.status = MemberStatus.suspended
    member.banned_until = datetime.now(UTC) - timedelta(minutes=1)
    db_session.commit()
    assert chat.send(db_session, member.id, conv.id, client_id="s1", body="back").message


def test_a_suspended_mentor_cannot_send(db_session):
    _, conv = seed_conversation(db_session)
    mentor = db_session.get(ListenerProfile, conv.seeded.mentor_id)
    mentor.vetting_status = VettingStatus.suspended
    db_session.commit()
    with pytest.raises(chat.NotAllowed) as refused:
        chat.send(db_session, mentor.id, conv.id, client_id="m1", body="hello")
    assert refused.value.code == "mentor_suspended"


def test_a_stranger_cannot_send(db_session):
    _, conv = seed_conversation(db_session)
    with pytest.raises(chat.NotAllowed):
        chat.send(
            db_session, "00000000-0000-0000-0000-000000000000", conv.id, client_id="x", body="hi"
        )


# ---- exactly once ---------------------------------------------------------------------------


def test_a_retried_crisis_send_stores_one_message_and_one_flag(db_session, _no_fanout):
    member, conv = seed_conversation(db_session)
    first = chat.send(db_session, member.id, conv.id, client_id="r1", body="i want to die")
    again = chat.send(db_session, member.id, conv.id, client_id="r1", body="i want to die")
    assert again.duplicate and again.message["id"] == first.message["id"]
    assert _count(db_session, ChatMessage) == 1
    assert _count(db_session, SafetyFlag) == 1
    assert len(_no_fanout) == 1  # the retry is acked to the retrier, not re-broadcast


# ---- fail-open, never silent -----------------------------------------------------------------


def test_a_failing_scan_delivers_and_says_so(monkeypatch, db_session, caplog):
    member, conv = seed_conversation(db_session)

    def boom(text):
        raise RuntimeError("scanner down")

    monkeypatch.setattr(chat.crisis, "scan", boom)
    with caplog.at_level(logging.ERROR, logger="mento.chat"):
        sent = chat.send(db_session, member.id, conv.id, client_id="f1", body="hello")
    assert sent.message is not None
    assert any("crisis scan FAILED" in r.getMessage() for r in caplog.records)


def test_a_failing_flag_write_still_carries_the_helpline_card(monkeypatch, db_session, caplog):
    member, conv = seed_conversation(db_session)

    def boom(*a, **k):
        raise RuntimeError("db hiccup")

    monkeypatch.setattr(chat.safety, "record_flag", boom)
    with caplog.at_level(logging.ERROR, logger="mento.chat"):
        sent = chat.send(db_session, member.id, conv.id, client_id="f2", body="i want to die")
    assert sent.message["crisis"]["signal"] == "suicidal"
    assert any("flag NOT persisted" in r.getMessage() for r in caplog.records)


# ---- jobs --------------------------------------------------------------------------------------


def test_the_push_job_is_queued_with_ids_only(db_session):
    member, conv = seed_conversation(db_session)
    chat.send(db_session, member.id, conv.id, client_id="j1", body="a private thing")
    rows = db_session.execute(
        text("SELECT task_name, args::text FROM procrastinate_jobs ORDER BY id")
    ).all()
    assert [r.task_name for r in rows] == ["push.message"]
    assert "private" not in rows[0].args


# ---- one site ----------------------------------------------------------------------------------


def test_there_is_exactly_one_place_that_writes_a_chat_message():
    """grep for INSERT and `.add(ChatMessage` shows one site (T5.2 accept) — done on the
    AST so a comment or a docstring cannot fool it."""
    sites: list[str] = []
    for path in APP_DIR.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        parents: dict[ast.AST, ast.AST] = {}
        for node in ast.walk(tree):
            for child in ast.iter_child_nodes(node):
                parents[child] = node
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            src = ast.unparse(node.func)
            args = " ".join(ast.unparse(a) for a in node.args)
            constructs = src == "ChatMessage"
            inserts = src in ("insert", "sa.insert", "sqlalchemy.insert") and "ChatMessage" in args
            raw = "insert into chat_messages" in ast.unparse(node).lower()
            if constructs or inserts or raw:
                fn = node
                while fn in parents and not isinstance(fn, ast.FunctionDef):
                    fn = parents[fn]
                where = fn.name if isinstance(fn, ast.FunctionDef) else "<module>"
                sites.append(f"{path.relative_to(APP_DIR).as_posix()}::{where}")
    assert sites == ["services/chat.py::persist_message"]
