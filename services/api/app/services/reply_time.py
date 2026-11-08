"""How quickly a mentor usually replies (DECISIONS section P.6): "Usually replies within a day"
or "within 2 days", from the median over the last 30 days of how long a request addressed to
them took to be accepted. A request they never answered (nudged at 24 hours, then closed)
counts as slow. Nothing is shown until REQUIRED requests give a fair picture, so one slow reply
cannot brand a mentor.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from statistics import median

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import RequestStatus
from app.models.request import ConversationRequest
from app.services.request_ageing import EXPIRE_AFTER

WINDOW = timedelta(days=30)
REQUIRED = 5
DAY = timedelta(hours=24)


def _aware(t: datetime) -> datetime:
    return t if t.tzinfo else t.replace(tzinfo=UTC)


def reply_within(db: Session, listener_ids: list[str]) -> dict[str, str | None]:
    """`"day"`, `"two_days"` or None for each id."""
    out: dict[str, str | None] = {lid: None for lid in listener_ids}
    if not listener_ids:
        return out
    since = datetime.now(UTC) - WINDOW
    rows = db.execute(
        select(
            ConversationRequest.target_listener_id,
            ConversationRequest.status,
            ConversationRequest.created_at,
            ConversationRequest.nudged_at,
            Conversation.created_at,
        )
        .outerjoin(Conversation, Conversation.id == ConversationRequest.conversation_id)
        .where(
            ConversationRequest.target_listener_id.in_(listener_ids),
            ConversationRequest.created_at >= since,
        )
    ).all()
    samples: dict[str, list[float]] = {}
    for lid, status, asked, nudged, opened in rows:
        if status == RequestStatus.matched and opened is not None:
            took = _aware(opened) - _aware(asked)
        elif status == RequestStatus.expired and nudged is not None:
            took = EXPIRE_AFTER + timedelta(seconds=1)  # no reply in the time we wait
        else:
            continue
        samples.setdefault(lid, []).append(took.total_seconds())
    for lid, secs in samples.items():
        if len(secs) < REQUIRED:
            continue
        m = median(secs)
        out[lid] = (
            "day"
            if m <= DAY.total_seconds()
            else "two_days" if m <= EXPIRE_AFTER.total_seconds() else None
        )
    return out
