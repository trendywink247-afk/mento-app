"""Rotating mentor names (DECISIONS §L.6).

Every mentor carries a fresh "[Adjective] [Noun]" name each rotation day, so Browse
always feels new and nobody fixates on — or re-targets — one name. Continuity is by
consent instead (services/in_touch.py).

When
----
A rotation day starts at **04:00 IST**, not midnight: midnight is when aspirants are
most likely to be mid-conversation, and the quietest hour is the kindest moment for a
header to change. (The message allowance resets at 00:00 IST — a different clock on
purpose: "per day" should mean the calendar day.)

How
---
There is no scheduler in this API (the capacity and presence sweeps are inline too), so
rotation is LAZY: the surfaces that show mentor names call `ensure_fresh` first. One
mentor per transaction, row taken with SKIP LOCKED — the matcher never waits on a
rename. A transaction-scoped advisory lock serialises name picking across workers, so
two mentors can never be handed the same new name.

What a rename touches
---------------------
`listener_profiles.persona_name` (every surface reads it), one closed and one opened
span in `listener_name_history`, and — after the commit, best-effort, retried by the
next pass — the mentor's Stream user name, so the chat header and the thread agree.

What a rename must NOT do (the "coherent history" rule)
-------------------------------------------------------
- An ACTIVE conversation follows the mentor's current name and says "first talked as
  <the name at its start>" — one name in the header and on every bubble, plus the
  thread's own memory of who that was.
- An ENDED or wiped conversation with a mentor the member is NOT in touch with keeps
  the name it ended under. Tomorrow's name for that mentor is exactly what §L.6 says
  the member does not get without asking.
- A name is never issued while it is any mentor's current name or is held as a
  "first met as" by a pending or accepted link (§L.7); names used in the last
  `REUSE_DAYS` days are avoided while the name space allows.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Iterable
from datetime import UTC, date, datetime, timedelta, timezone

from fastapi import BackgroundTasks, Depends
from sqlalchemy import or_, select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal, get_db
from app.models.enums import LinkStatus
from app.models.listener import ListenerProfile
from app.models.mentor_link import ListenerNameHistory, MentorLink
from app.services import stream
from app.services.persona import generate_persona

logger = logging.getLogger("mento.mentor_names")

IST = timezone(timedelta(hours=5, minutes=30), "IST")
ROTATION_HOUR_IST = 4
REUSE_DAYS = 30
_PICK_TRIES = 60
_ADVISORY_KEY = 4_061_907  # arbitrary, app-wide: "mentor name pick in progress"
_RECHECK_SECONDS = 60.0

# Test hook (same idiom as ratelimit.ENABLED): conftest turns rotation off so suites
# that assert on seeded names can never meet a 04:00 boundary; the rotation tests turn
# it back on. None = defer to settings.
ENABLED: bool | None = None

_memo_lock = threading.Lock()
_memo: tuple[date, float] | None = None  # (rotation day checked, monotonic time)


def _utcnow() -> datetime:
    """The pass's clock — one seam, so tests can walk it across a 04:00 boundary."""
    return datetime.now(UTC)


def is_enabled() -> bool:
    if ENABLED is not None:
        return ENABLED
    return get_settings().mentor_name_rotation_enabled


def rotation_day(now: datetime) -> date:
    return (now.astimezone(IST) - timedelta(hours=ROTATION_HOUR_IST)).date()


def next_rotation_at(now: datetime) -> datetime:
    """When the current names change — for the mentor's "your name changes in 9 h"."""
    start = datetime.combine(
        rotation_day(now) + timedelta(days=1), datetime.min.time(), tzinfo=IST
    ) + timedelta(hours=ROTATION_HOUR_IST)
    return start.astimezone(UTC)


# --- picking ---------------------------------------------------------------------


def _held_names(db: Session) -> set[str]:
    """The hard exclusions: a name someone carries now, or one a member still holds."""
    current = set(db.scalars(select(ListenerProfile.persona_name)).all())
    held = set(
        db.scalars(
            select(MentorLink.first_met_as).where(
                MentorLink.status.in_((LinkStatus.pending, LinkStatus.accepted))
            )
        ).all()
    )
    return current | held


def _recent_names(db: Session, now: datetime) -> set[str]:
    cutoff = now - timedelta(days=REUSE_DAYS)
    return set(
        db.scalars(
            select(ListenerNameHistory.persona_name).where(
                or_(ListenerNameHistory.valid_to.is_(None), ListenerNameHistory.valid_to >= cutoff)
            )
        ).all()
    )


def _pick(db: Session, now: datetime) -> str | None:
    hard = _held_names(db)
    soft = hard | _recent_names(db, now)
    for avoid in (soft, hard):
        for _ in range(_PICK_TRIES):
            name = generate_persona().name
            if name not in avoid:
                return name
    return None


# --- the pass --------------------------------------------------------------------


def _open_span(db: Session, listener: ListenerProfile) -> ListenerNameHistory | None:
    return db.scalars(
        select(ListenerNameHistory)
        .where(
            ListenerNameHistory.listener_id == listener.id, ListenerNameHistory.valid_to.is_(None)
        )
        .order_by(ListenerNameHistory.valid_from.desc())
    ).first()


def _rotate_one(db: Session, listener_id: str, today: date, now: datetime) -> bool:
    """One mentor, one transaction. Returns True when a rename happened."""
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _ADVISORY_KEY})
    li = db.execute(
        select(ListenerProfile)
        .where(ListenerProfile.id == listener_id)
        .with_for_update(skip_locked=True)
        .execution_options(populate_existing=True)
    ).scalar_one_or_none()
    if li is None:  # a matcher holds the row — the next pass gets it
        db.rollback()
        return False
    if li.persona_name_day is not None and li.persona_name_day >= today:
        db.rollback()
        return False
    span = _open_span(db, li)
    if li.persona_name_day is None:
        # First sight of this mentor: stamp, do not rename. Their first name is theirs
        # for the rest of its day.
        if span is None:
            db.add(
                ListenerNameHistory(
                    listener_id=li.id, persona_name=li.persona_name, valid_from=li.created_at
                )
            )
        li.persona_name_day = today
        db.commit()
        return False
    new_name = _pick(db, now)
    if new_name is None:
        logger.warning("mentor name space exhausted — a mentor keeps their name today")
        db.rollback()
        return False
    if span is None:
        db.add(
            ListenerNameHistory(
                listener_id=li.id,
                persona_name=li.persona_name,
                valid_from=li.created_at,
                valid_to=now,
            )
        )
    else:
        span.valid_to = now
    db.add(ListenerNameHistory(listener_id=li.id, persona_name=new_name, valid_from=now))
    li.persona_name = new_name
    li.persona_name_day = today
    li.persona_stream_synced = False
    db.commit()
    return True


def ensure_fresh(db: Session, now: datetime | None = None, *, force: bool = False) -> bool:
    """Rotate every mentor whose name belongs to an earlier rotation day. Cheap when
    there is nothing to do (one indexed probe at most once a minute per process).
    Returns True when Stream has names to catch up on. Never raises — a failed
    rotation must not take Browse down with it."""
    global _memo
    if not is_enabled():
        return False
    now = now or _utcnow()
    today = rotation_day(now)
    if not force:
        with _memo_lock:
            if (
                _memo is not None
                and _memo[0] == today
                and time.monotonic() - _memo[1] < _RECHECK_SECONDS
            ):
                return False
    try:
        due = db.scalars(
            select(ListenerProfile.id)
            .where(
                or_(
                    ListenerProfile.persona_name_day.is_(None),
                    ListenerProfile.persona_name_day < today,
                )
            )
            .order_by(ListenerProfile.id)
        ).all()
        for listener_id in due:
            _rotate_one(db, listener_id, today, now)
        unsynced = db.scalars(
            select(ListenerProfile.id).where(ListenerProfile.persona_stream_synced.is_(False))
        ).first()
        db.rollback()  # leave the caller's session with no open transaction of ours
    except Exception as exc:  # noqa: BLE001 — never take a read endpoint down
        db.rollback()
        logger.warning("mentor name rotation failed (%s)", type(exc).__name__)
        return False
    with _memo_lock:
        _memo = (today, time.monotonic())
    return unsynced is not None


def sync_stream_names() -> None:
    """Push renamed mentors' names to Stream. Runs AFTER the response (background
    task), own session, never holds a transaction across the HTTP call."""
    try:
        with SessionLocal() as db:
            rows = db.execute(
                select(ListenerProfile.id, ListenerProfile.persona_name).where(
                    ListenerProfile.persona_stream_synced.is_(False)
                )
            ).all()
            db.rollback()
            for listener_id, name in rows:
                if not stream.rename_user(listener_id, name):
                    continue
                li = db.get(ListenerProfile, listener_id)
                # Only if it is still the name we pushed (a later rotation re-flags it).
                if li is not None and li.persona_name == name:
                    li.persona_stream_synced = True
                db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("mentor name sync to Stream failed (%s)", type(exc).__name__)


def fresh_names(background: BackgroundTasks, db: Session = Depends(get_db)) -> None:
    """Router dependency for every surface that shows a mentor's name."""
    if ensure_fresh(db):
        background.add_task(sync_stream_names)


# --- reading history -------------------------------------------------------------


class NameBook:
    """Name lookups for a batch of mentors — one query, resolved in memory."""

    def __init__(self, db: Session, listener_ids: Iterable[str]) -> None:
        ids = set(listener_ids)
        self._spans: dict[str, list[ListenerNameHistory]] = {}
        if not ids:
            return
        for span in db.scalars(
            select(ListenerNameHistory)
            .where(ListenerNameHistory.listener_id.in_(ids))
            .order_by(ListenerNameHistory.valid_from)
        ).all():
            self._spans.setdefault(span.listener_id, []).append(span)

    def name_at(self, listener_id: str, when: datetime | None, current: str) -> str:
        """The name this mentor carried at `when`. No record (a mentor who has never
        been through a pass, a moment before their first span) → the current name."""
        if when is None:
            return current
        spans = self._spans.get(listener_id) or []
        for span in spans:
            if span.valid_from <= when and (span.valid_to is None or when < span.valid_to):
                return span.persona_name
        if spans and when < spans[0].valid_from:
            return spans[0].persona_name
        return current


def first_met_label(first_name: str, shown_name: str) -> str | None:
    """ "first met as …" only when it says something the shown name does not."""
    return first_name if first_name and first_name != shown_name else None
