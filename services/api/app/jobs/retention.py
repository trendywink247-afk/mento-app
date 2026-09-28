"""Own-chat message partitions and retention (WS5 T5.6).

`chat_messages` is partitioned by month on `created_at`: `chat_messages_p2026_09` holds
September 2026 (UTC), and so on, with `chat_messages_default` as a catch-all so an
insert can never fail for want of a partition.

- `ensure_partitions` keeps the current month and the next MONTHS_AHEAD ready. Run by
  the migration, dev `init_db`, and a daily job — so the default partition should stay
  empty (a row there blocks creating that month's partition; the job then logs ERROR).
- `drop_expired` drops every monthly partition whose whole range is older than the
  retention window. That is a metadata operation: the bodies are gone at once, with no
  row-by-row DELETE and no vacuum debt. Messages therefore live between `retention`
  and `retention + ~1 month`.

The retention number is the founder's to set (H13 / decision D1) and is NOT decided:
`message_retention_days` unset means nothing is dropped, and the job says so every run.
"""

from __future__ import annotations

import logging
import re
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session

from app.models.chat_message import PARTITION_PREFIX

logger = logging.getLogger("mento.retention")

MONTHS_AHEAD = 2
DEFAULT_PARTITION = "chat_messages_default"
_NAME = re.compile(rf"^{PARTITION_PREFIX}(\d{{4}})_(\d{{2}})$")


def _month_start(day: date) -> date:
    return day.replace(day=1)


def _next_month(first: date) -> date:
    return (first.replace(day=28) + timedelta(days=4)).replace(day=1)


def partition_name(first: date) -> str:
    return f"{PARTITION_PREFIX}{first.year:04d}_{first.month:02d}"


def ensure_partitions(
    conn: Connection | Session, now: datetime | None = None, months_ahead: int = MONTHS_AHEAD
) -> list[str]:
    """Create the default partition and this month's + the next `months_ahead` monthly
    partitions if missing. Idempotent. The caller commits. Returns what exists now."""
    now = now or datetime.now(UTC)
    conn.execute(
        text(f"CREATE TABLE IF NOT EXISTS {DEFAULT_PARTITION} PARTITION OF chat_messages DEFAULT")
    )
    first = _month_start(now.astimezone(UTC).date())
    names = []
    for _ in range(months_ahead + 1):
        upper = _next_month(first)
        name = partition_name(first)
        conn.execute(
            text(
                f"CREATE TABLE IF NOT EXISTS {name} PARTITION OF chat_messages "
                f"FOR VALUES FROM ('{first.isoformat()} 00:00:00+00') "
                f"TO ('{upper.isoformat()} 00:00:00+00')"
            )
        )
        names.append(name)
        first = upper
    return names


def monthly_partitions(conn: Connection | Session) -> list[tuple[str, date]]:
    """(name, first day) of every monthly partition attached to chat_messages."""
    rows = conn.execute(
        text(
            "SELECT c.relname FROM pg_inherits i "
            "JOIN pg_class c ON c.oid = i.inhrelid "
            "JOIN pg_class p ON p.oid = i.inhparent "
            "WHERE p.relname = 'chat_messages'"
        )
    ).scalars()
    found = []
    for name in rows:
        m = _NAME.match(name)
        if m:
            found.append((name, date(int(m.group(1)), int(m.group(2)), 1)))
    return sorted(found, key=lambda x: x[1])


def drop_expired(
    conn: Connection | Session, retention_days: int | None, now: datetime | None = None
) -> list[str]:
    """Drop every monthly partition that ends before `now - retention_days`. With no
    retention decided (None) nothing is dropped. The caller commits. Returns the
    dropped names."""
    if retention_days is None:
        logger.warning(
            "message retention is not set (MESSAGE_RETENTION_DAYS, founder decision H13) "
            "— no own-chat messages dropped"
        )
        return []
    if retention_days < 1:
        raise ValueError("message_retention_days must be at least 1")
    now = now or datetime.now(UTC)
    cutoff = (now.astimezone(UTC) - timedelta(days=retention_days)).date()
    dropped = []
    for name, first in monthly_partitions(conn):
        if _next_month(first) <= cutoff:  # the partition's whole range is past retention
            conn.execute(text(f"DROP TABLE {name}"))
            dropped.append(name)
    if dropped:
        logger.info("own-chat retention dropped %s", ",".join(dropped))
    return dropped


def default_partition_rows(conn: Connection | Session) -> int:
    return int(conn.execute(text(f"SELECT count(*) FROM {DEFAULT_PARTITION}")).scalar_one())
