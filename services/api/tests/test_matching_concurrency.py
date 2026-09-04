"""Prove General matching never double-assigns a listener under concurrency.

The matcher selects an available listener with `with_for_update(skip_locked=True)`
and increments `active_conversations`. Under concurrent requests for a single
listener with capacity 1, exactly one request must win; the rest must get
`NoListenerAvailable` (the API turns that into a 503 "try again"). This file
demonstrates both the *mechanism* (SKIP LOCKED skips a held row) and the
*outcome* (a thundering-herd of requests yields exactly one assignment).
"""

from __future__ import annotations

import threading
from datetime import date

import pytest
from sqlalchemy import func, select, text

from app.models.conversation import Conversation
from app.models.enums import ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.services import stream
from app.services.matching import NoListenerAvailable, match_general

from .conftest import TestSession, requires_postgres


@pytest.fixture(autouse=True)
def _stub_stream_channel(monkeypatch):
    """Keep the matcher test hermetic: it proves DB row-locking, not Stream. Stub the
    channel call so it doesn't hit the real Stream API when creds are present."""
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )


def _seed_listener(session, *, max_concurrent: int = 1) -> str:
    listener = ListenerProfile(
        persona_name="Silent Mountain",
        persona_avatar="mountain",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=0,
        max_concurrent=max_concurrent,
    )
    session.add(listener)
    session.flush()
    return listener.id


def _seed_user(session, i: int) -> str:
    user = User(
        persona_name=f"Seeker {i}",
        persona_avatar="seed",
        dob=date(2000, 1, 1),
        age_at_signup=26,
    )
    session.add(user)
    session.flush()
    return user.id


@requires_postgres
def test_matcher_skips_a_locked_listener_row(db_session):
    """Mechanism check: while one transaction holds the only eligible listener
    row locked, the matcher must SKIP it and report no listener available —
    not block, and not hand out the same listener twice."""
    listener_id = _seed_listener(db_session, max_concurrent=1)
    user_id = _seed_user(db_session, 0)
    db_session.commit()

    holder = TestSession()
    other = TestSession()
    try:
        # Simulate a winning matcher mid-transaction: lock the row, hold it open.
        locked = holder.execute(
            select(ListenerProfile).where(ListenerProfile.id == listener_id).with_for_update()
        ).scalar_one()
        assert locked.id == listener_id

        # Insurance: if SKIP LOCKED were ever dropped, the matcher would block on
        # the held row — fail fast with a lock timeout instead of hanging forever.
        other.execute(text("SET lock_timeout = '3s'"))
        user = other.get(User, user_id)

        # The only eligible listener is locked → matcher skips it → no listener.
        with pytest.raises(NoListenerAvailable):
            match_general(other, user)
    finally:
        other.rollback()
        other.close()
        holder.rollback()
        holder.close()


@requires_postgres
def test_concurrent_matches_never_double_assign(db_session):
    """Outcome check: fire N simultaneous match requests at a single listener
    with capacity 1. Exactly one wins; the rest get NoListenerAvailable, and the
    DB ends with active_conversations == 1 and exactly one conversation row."""
    n = 32
    listener_id = _seed_listener(db_session, max_concurrent=1)
    user_ids = [_seed_user(db_session, i) for i in range(n)]
    db_session.commit()  # commit so worker connections can see the rows

    barrier = threading.Barrier(n)
    results: list[tuple[str, str | None]] = []
    results_lock = threading.Lock()

    def worker(user_id: str) -> None:
        session = TestSession()
        session.connection()  # reserve a real connection BEFORE the barrier
        try:
            barrier.wait()  # release all workers at the same instant
            user = session.get(User, user_id)
            convo = match_general(session, user)
            outcome: tuple[str, str | None] = ("matched", convo.listener_id)
        except NoListenerAvailable:
            session.rollback()
            outcome = ("none", None)
        except Exception as exc:  # surface anything unexpected as a failure
            session.rollback()
            outcome = ("error", repr(exc))
        finally:
            session.close()
        with results_lock:
            results.append(outcome)

    threads = [threading.Thread(target=worker, args=(uid,)) for uid in user_ids]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    matched = [r for r in results if r[0] == "matched"]
    none = [r for r in results if r[0] == "none"]
    errors = [r for r in results if r[0] == "error"]

    assert errors == [], f"unexpected worker errors: {errors}"
    assert len(matched) == 1, f"expected exactly 1 winner, got {len(matched)}: {matched}"
    assert len(none) == n - 1, f"expected {n - 1} 'none', got {len(none)}"

    # Ground truth straight from the database.
    check = TestSession()
    try:
        listener = check.get(ListenerProfile, listener_id)
        convo_count = check.execute(
            select(func.count())
            .select_from(Conversation)
            .where(Conversation.listener_id == listener_id)
        ).scalar_one()
    finally:
        check.close()

    assert listener.active_conversations == 1, listener.active_conversations
    assert convo_count == 1, convo_count
