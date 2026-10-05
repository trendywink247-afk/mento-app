"""Member message allowance (DECISIONS §L.2): 3 in a row, 10 a day.

Where it sits — and why the ORDER is the safety property
--------------------------------------------------------
The Stream before-send hook scans FIRST. A message the crisis scan flags is always
delivered with its helpline card and never reaches `register` at all; it is only
tallied (`note_crisis_exempt`) as a crisis-exempt send. Only a non-crisis MEMBER
message is counted, and only that can be held. Mentor messages are never limited —
a mentor message resets the member's streak in that conversation.

"A message (or conversation) flagged by the crisis scan is never blocked and never
counted": a conversation that raised a crisis flag in the last
`allowance_crisis_exempt_hours` is exempt as a whole — a person who has just said
something frightening must not be told to wait after their third follow-up.

Rules
-----
- In a row: per conversation (`conversations.member_streak`).
- Per day: per MEMBER across all their conversations, on the IST calendar day
  (UTC+05:30, no DST — the product's home). Resets at 00:00 IST.
- Both exhausted → the reason is `daily` (the longer wait is the honest one to name).
- Fail-open: the caller wraps this in a time budget and a try/except; any fault
  delivers the message.

Numbers only — nothing here ever sees or stores message text.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.allowance import RETENTION_DAYS, MessageAllowanceDay
from app.models.conversation import Conversation
from app.models.enums import SafetySignal
from app.models.safety import SafetyFlag
from app.schemas import AllowanceOut
from app.services import locks

IST = timezone(timedelta(hours=5, minutes=30), "IST")

REASON_IN_A_ROW = "in_a_row"
REASON_DAILY = "daily"


def ist_day(now: datetime) -> date:
    return now.astimezone(IST).date()


def resets_at(now: datetime) -> datetime:
    """The next 00:00 IST, as an aware UTC datetime."""
    local = now.astimezone(IST)
    midnight = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(UTC)


@dataclass(frozen=True)
class AllowanceState:
    """What the composer needs: "7 of 10 left today", and whether to show the note."""

    in_a_row: int
    in_a_row_limit: int
    sent_today: int
    daily_limit: int
    left_today: int
    resets_at: datetime
    # None = the member may send. Otherwise REASON_IN_A_ROW / REASON_DAILY.
    held_reason: str | None
    enforced: bool

    @property
    def can_send(self) -> bool:
        return self.held_reason is None


def to_out(state: AllowanceState) -> AllowanceOut:
    return AllowanceOut(
        in_a_row=state.in_a_row,
        in_a_row_limit=state.in_a_row_limit,
        sent_today=state.sent_today,
        daily_limit=state.daily_limit,
        left_today=state.left_today,
        resets_at=state.resets_at.isoformat(),
        can_send=state.can_send,
        held_reason=state.held_reason,
        enforced=state.enforced,
    )


@dataclass(frozen=True)
class Verdict:
    """One message's outcome in the hook. `held` names the rule that stopped THIS
    message (None = deliver); `state` is the member's allowance AFTER it — what the
    composer should show next."""

    held: str | None
    state: AllowanceState


def _count_word(n: int) -> str:
    words = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 10: "ten"}
    return words.get(n, str(n))


def note(reason: str) -> str:
    """The calm, still line a held message comes back with (board A22). The app
    renders its own localised copy from the machine code; this is the fallback an
    older build shows. Never a scolding, never a hint that more can be bought."""
    s = get_settings()
    if reason == REASON_DAILY:
        return (
            f"That's your {_count_word(s.allowance_per_day)} for today. "
            "You can write again tomorrow — your Journal is open meanwhile."
        )
    return (
        f"That's {_count_word(s.allowance_in_a_row)} in a row. "
        "Give your mentor a moment to reply."
    )


def _conversation_exempt(db: Session, conversation_id: str, now: datetime) -> bool:
    hours = get_settings().allowance_crisis_exempt_hours
    if hours <= 0:
        return False
    return (
        db.execute(
            select(SafetyFlag.id)
            .where(
                SafetyFlag.conversation_id == conversation_id,
                SafetyFlag.signal != SafetySignal.none,
                SafetyFlag.created_at >= now - timedelta(hours=hours),
            )
            .limit(1)
        ).first()
        is not None
    )


def _day_row(db: Session, user_id: str, day: date, *, create: bool) -> MessageAllowanceDay | None:
    row = db.get(MessageAllowanceDay, {"user_id": user_id, "day": day})
    if row is not None or not create:
        return row
    row = MessageAllowanceDay(
        user_id=user_id, day=day, sent=0, crisis_exempt=0, row_cap_hits=0, day_cap_hits=0
    )
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
    except IntegrityError:
        # Only reachable without row locks (SQLite dev fallback): someone else made it.
        return db.get(MessageAllowanceDay, {"user_id": user_id, "day": day})
    # First message of a new day: drop this member's rows past retention.
    db.execute(
        delete(MessageAllowanceDay).where(
            MessageAllowanceDay.user_id == user_id,
            MessageAllowanceDay.day < day - timedelta(days=RETENTION_DAYS),
        )
    )
    return row


def _state(streak: int, sent: int, now: datetime, *, exempt: bool) -> AllowanceState:
    s = get_settings()
    held: str | None = None
    if s.allowance_enforced and not exempt:
        if sent >= s.allowance_per_day:
            held = REASON_DAILY
        elif streak >= s.allowance_in_a_row:
            held = REASON_IN_A_ROW
    return AllowanceState(
        in_a_row=streak,
        in_a_row_limit=s.allowance_in_a_row,
        sent_today=sent,
        daily_limit=s.allowance_per_day,
        left_today=max(0, s.allowance_per_day - sent),
        resets_at=resets_at(now),
        held_reason=held,
        enforced=s.allowance_enforced,
    )


def state_for(
    db: Session, user_id: str, convo: Conversation | None, now: datetime | None = None
) -> AllowanceState:
    """Read-only: the member's allowance right now, for one conversation (or, with
    `convo=None`, the daily half only — the first-question builder has no chat yet)."""
    now = now or datetime.now(UTC)
    row = _day_row(db, user_id, ist_day(now), create=False)
    exempt = convo is not None and _conversation_exempt(db, convo.id, now)
    return _state(
        convo.member_streak if convo is not None else 0,
        row.sent if row is not None else 0,
        now,
        exempt=exempt,
    )


def find_conversation(db: Session, channel_id: str):
    """`channel_id` is whatever `chat.channel_key` sent: the Stream channel id for a
    Stream room, or the conversation's own id for an own-chat room (T5.3's `chat.send`
    passes `convo.stream_channel_id or convo.id`, and own-chat rooms keep that column
    NULL — see `services/push.py`'s `notify_message_for_channel` for the same pair)."""
    return db.execute(
        select(Conversation.id, Conversation.user_id, Conversation.listener_id).where(
            or_(
                Conversation.stream_channel_id == channel_id,
                and_(
                    Conversation.chat_backend == "own",
                    Conversation.stream_channel_id.is_(None),
                    Conversation.id == channel_id,
                ),
            )
        )
    ).first()


def _done(db: Session, commit: bool) -> None:
    if commit:
        db.commit()
    else:
        db.flush()


def register(
    db: Session,
    *,
    channel_id: str,
    sender_id: str,
    now: datetime | None = None,
    commit: bool = True,
) -> Verdict | None:
    """Count one NON-crisis message on its way through the before-send hook and say
    whether it is held. Returns None when the allowance does not apply (a mentor's
    message, an unknown channel, a sender who is not the member).

    Commits unless `commit=False`: then the count (and the member-row lock that
    serialises it) stays in the caller's transaction, so the own-chat write path
    stores the message and its count in ONE commit (WS5 T5.3) — and a message that
    never lands is never counted.

    A held message is not counted. Serialised per member (`locks.serialize_member`)
    so two quick sends can never both take the last place."""
    now = now or datetime.now(UTC)
    s = get_settings()
    found = find_conversation(db, channel_id)
    if found is None:
        return None
    convo_id, member_id, listener_id = found
    if sender_id == listener_id:
        # The mentor replied: the member's run in this conversation starts over.
        db.execute(
            update(Conversation)
            .where(Conversation.id == convo_id, Conversation.member_streak != 0)
            .values(member_streak=0, updated_at=Conversation.updated_at)
        )
        _done(db, commit)
        return None
    if sender_id != member_id:
        return None

    locks.serialize_member(db, member_id)
    day = ist_day(now)
    row = _day_row(db, member_id, day, create=True)
    if row is None:  # pragma: no cover — SQLite race only
        db.rollback()
        return None
    streak = db.execute(
        select(Conversation.member_streak).where(Conversation.id == convo_id)
    ).scalar_one()

    if _conversation_exempt(db, convo_id, now):
        row.crisis_exempt += 1
        _done(db, commit)
        return Verdict(held=None, state=_state(streak, row.sent, now, exempt=True))

    before = _state(streak, row.sent, now, exempt=False)
    if before.held_reason is not None:
        if before.held_reason == REASON_DAILY:
            row.day_cap_hits += 1
        else:
            row.row_cap_hits += 1
        _done(db, commit)
        return Verdict(held=before.held_reason, state=before)

    row.sent += 1
    if row.sent >= s.allowance_per_day:
        row.reached_day_cap = True
    db.execute(
        update(Conversation)
        .where(Conversation.id == convo_id)
        .values(member_streak=Conversation.member_streak + 1, updated_at=Conversation.updated_at)
    )
    sent = row.sent
    _done(db, commit)
    return Verdict(held=None, state=_state(streak + 1, sent, now, exempt=False))


def note_crisis_exempt(
    db: Session, *, channel_id: str, sender_id: str, now: datetime | None = None
) -> None:
    """Tally a crisis-flagged MEMBER message as delivered-but-never-counted. Numbers
    only; the caller treats any failure as nothing (the message is already on its
    way with its helpline card)."""
    now = now or datetime.now(UTC)
    found = find_conversation(db, channel_id)
    if found is None or sender_id != found[1]:
        return
    locks.serialize_member(db, sender_id)
    row = _day_row(db, sender_id, ist_day(now), create=True)
    if row is None:  # pragma: no cover — SQLite race only
        db.rollback()
        return
    row.crisis_exempt += 1
    db.commit()


@dataclass(frozen=True)
class DayCounts:
    day: date
    messages_sent: int
    crisis_exempt_sends: int
    in_a_row_pauses: int
    members_paused_in_a_row: int
    daily_cap_holds: int
    members_reached_daily_cap: int


def daily_counts(db: Session, days: int, now: datetime | None = None) -> list[DayCounts]:
    """Admin numbers for the last `days` IST days, oldest first, zero-filled. Never a
    member id, never text — aggregates only (T&S #10)."""
    now = now or datetime.now(UTC)
    today = ist_day(now)
    first = today - timedelta(days=days - 1)
    m = MessageAllowanceDay
    rows = db.execute(
        select(
            m.day,
            func.coalesce(func.sum(m.sent), 0),
            func.coalesce(func.sum(m.crisis_exempt), 0),
            func.coalesce(func.sum(m.row_cap_hits), 0),
            func.count().filter(m.row_cap_hits > 0),
            func.coalesce(func.sum(m.day_cap_hits), 0),
            func.count().filter((m.reached_day_cap.is_(True)) | (m.day_cap_hits > 0)),
        )
        .where(m.day >= first, m.day <= today)
        .group_by(m.day)
    ).all()
    by_day = {r[0]: r for r in rows}
    out: list[DayCounts] = []
    for i in range(days):
        d = first + timedelta(days=i)
        r = by_day.get(d)
        out.append(
            DayCounts(
                day=d,
                messages_sent=int(r[1]) if r else 0,
                crisis_exempt_sends=int(r[2]) if r else 0,
                in_a_row_pauses=int(r[3]) if r else 0,
                members_paused_in_a_row=int(r[4]) if r else 0,
                daily_cap_holds=int(r[5]) if r else 0,
                members_reached_daily_cap=int(r[6]) if r else 0,
            )
        )
    return out
