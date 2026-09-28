"""WS4 T4.3 — the sweeps and the name rotation run as periodic jobs in the worker.

Every job here can fire twice (a worker restart mid-run, two workers during a deploy,
a manual re-run from the admin) — so each one is proven idempotent: the second run
finds nothing to do. The inline fallbacks (the matcher's self-heal, the lazy name
pass on Browse) stay; these jobs only mean nobody has to wait for traffic.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import text

from app import jobs
from app.jobs import queue, tasks, worker
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.services import mentor_names, stream

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres

NOW = datetime(2026, 3, 2, 6, 0, tzinfo=UTC)  # 11:30 IST


def _listener(s, name: str, **fields) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="owl",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=0,
        **fields,
    )
    s.add(li)
    s.flush()
    return li.id


def _member(s) -> str:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def test_the_schedule():
    schedule = {pt.task.name: pt.cron for pt in queue.periodic_registry.periodic_tasks.values()}
    assert schedule == {
        "maintenance.capacity": "*/5 * * * *",
        # Cron runs in UTC: 22:30 UTC is 04:00 IST, the rotation hour.
        "maintenance.mentor_names": "30 22 * * *",
        "maintenance.prune_jobs": "17 3 * * *",
        # Own-chat partitions (WS5 T5.6): ready ahead, expired ones dropped.
        "maintenance.chat_partitions": "41 2 * * *",
    }
    rotation = datetime(2026, 3, 1, 22, 30, tzinfo=UTC).astimezone(mentor_names.IST)
    assert (rotation.hour, rotation.minute) == (mentor_names.ROTATION_HOUR_IST, 0)


def test_the_capacity_job_heals_then_finds_nothing_to_do(db_session):
    s = db_session
    long_ago = datetime.now(UTC) - timedelta(hours=48)
    gone = _listener(s, "Far Hill", last_seen_at=datetime.now(UTC) - timedelta(hours=1))
    drifted = _listener(s, "Still Pond")
    s.get(ListenerProfile, drifted).active_conversations = 3  # no conversation backs it
    holder = _listener(s, "Warm Field")
    s.add(
        Conversation(
            user_id=_member(s),
            listener_id=holder,
            status=ConversationStatus.active,
            stream_channel_id=f"ch-{uuid.uuid4().hex[:10]}",
            created_at=long_ago,
        )
    )
    s.get(ListenerProfile, holder).active_conversations = 1
    s.commit()

    first = tasks.maintenance_capacity(timestamp=0)
    assert first == {"stale_ended": 1, "listeners_corrected": 2, "presence_swept": 1}
    with TestSession() as check:
        assert check.get(ListenerProfile, gone).status == ListenerStatus.away
        assert check.get(ListenerProfile, drifted).active_conversations == 0
        assert check.get(ListenerProfile, holder).active_conversations == 0

    assert tasks.maintenance_capacity(timestamp=0) == {
        "stale_ended": 0,
        "listeners_corrected": 0,
        "presence_swept": 0,
    }


def test_the_name_job_rotates_once_per_rotation_day(db_session, monkeypatch):
    monkeypatch.setattr(mentor_names, "ENABLED", True)
    monkeypatch.setattr(mentor_names, "_memo", None)
    monkeypatch.setattr(mentor_names, "_utcnow", lambda: NOW)
    renamed: list[tuple[str, str]] = []
    monkeypatch.setattr(
        stream, "rename_user", lambda uid, name: renamed.append((uid, name)) or True
    )
    cedar = _listener(
        db_session,
        "Steady Cedar",
        persona_name_day=mentor_names.rotation_day(NOW) - timedelta(days=1),
        created_at=NOW - timedelta(days=30),
    )
    db_session.commit()

    tasks.maintenance_mentor_names(timestamp=0)
    with TestSession() as s:
        li = s.get(ListenerProfile, cedar)
        new_name = li.persona_name
        assert new_name != "Steady Cedar"
        assert li.persona_stream_synced is True
    assert renamed == [(cedar, new_name)]

    tasks.maintenance_mentor_names(timestamp=0)  # same rotation day: nothing moves
    with TestSession() as s:
        assert s.get(ListenerProfile, cedar).persona_name == new_name
    assert renamed == [(cedar, new_name)]


def test_the_prune_job_keeps_recent_failures_and_drops_old_ones(db_session):
    with TestSession() as s:
        jobs.enqueue(s, tasks.push_request_created, request_id="old")
        jobs.enqueue(s, tasks.push_request_created, request_id="recent")
        s.execute(text("UPDATE procrastinate_jobs SET status = 'failed'"))
        s.execute(
            text(
                "UPDATE procrastinate_events SET at = now() - interval '31 days' "
                "WHERE job_id = (SELECT id FROM procrastinate_jobs WHERE args->>'request_id' = 'old')"
            )
        )
        s.commit()

    assert tasks.maintenance_prune_jobs(timestamp=0) == 1
    assert tasks.maintenance_prune_jobs(timestamp=0) == 0
    with TestSession() as s:
        left = s.execute(text("SELECT args->>'request_id' FROM procrastinate_jobs")).scalars().all()
    assert left == ["recent"]


def test_the_worker_runs_a_maintenance_job_from_the_queue(db_session):
    """Registration, not just the function: the worker finds the task by name."""
    _listener(db_session, "Far Hill", last_seen_at=datetime.now(UTC) - timedelta(hours=1))
    jobs.enqueue(db_session, tasks.maintenance_capacity, timestamp=0)
    db_session.commit()
    worker.drain(queues=["maintenance"])
    with TestSession() as s:
        assert s.execute(text("SELECT count(*) FROM procrastinate_jobs")).scalar() == 0
        assert s.query(ListenerProfile).one().status == ListenerStatus.away


@pytest.mark.parametrize("runs", [1, 2])
def test_the_mentor_reply_job_ends_the_snooze_and_is_idempotent(db_session, runs):
    lid = _listener(db_session, "Warm Field")
    convo = Conversation(
        user_id=_member(db_session),
        listener_id=lid,
        status=ConversationStatus.active,
        stream_channel_id=f"ch-{uuid.uuid4().hex[:10]}",
        snoozed_until=datetime.now(UTC) + timedelta(hours=5),
    )
    db_session.add(convo)
    db_session.commit()
    for _ in range(runs):
        tasks.snooze_end_on_mentor_reply(channel_id=convo.stream_channel_id, sender_id=lid)
    with TestSession() as s:
        assert s.get(Conversation, convo.id).snoozed_until is None


def test_the_chat_partition_job_keeps_months_ready_and_drops_nothing_undecided(db_session):
    """No retention decided (founder, H13): the job only makes sure next months exist."""
    from app.jobs import retention

    before = {n for n, _ in retention.monthly_partitions(db_session)}
    result = tasks.maintenance_chat_partitions(timestamp=0)
    assert result["dropped"] == []
    assert set(result["ready"]) <= {n for n, _ in retention.monthly_partitions(db_session)}
    assert before <= {n for n, _ in retention.monthly_partitions(db_session)}
