"""Requests nobody has answered (DECISIONS section P.5).

After NUDGE_AFTER the member is asked what they want (send it to every verified mentor, choose
another mentor, keep waiting, or withdraw); nothing moves without their say-so, because their
words would otherwise reach people they did not pick. After EXPIRE_AFTER the request closes
with a kind message. A mentor's unanswered nudged requests also count toward their reply time.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.enums import RequestStatus
from app.models.request import ConversationRequest

NUDGE_AFTER = timedelta(hours=24)
EXPIRE_AFTER = timedelta(hours=48)


def run(db: Session, now: datetime | None = None) -> dict[str, list[str]]:
    """Expire what is 48 hours old and nudge what is 24 hours old. The caller commits and then
    pages the member for each id in `nudged`."""
    now = now or datetime.now(UTC)
    expired = list(
        db.scalars(
            update(ConversationRequest)
            .where(
                ConversationRequest.status == RequestStatus.pending,
                ConversationRequest.created_at <= now - EXPIRE_AFTER,
            )
            .values(status=RequestStatus.expired)
            .returning(ConversationRequest.id)
        )
    )
    nudged = list(
        db.scalars(
            update(ConversationRequest)
            .where(
                ConversationRequest.status == RequestStatus.pending,
                ConversationRequest.nudged_at.is_(None),
                ConversationRequest.created_at <= now - NUDGE_AFTER,
            )
            .values(nudged_at=now)
            .returning(ConversationRequest.id)
        )
    )
    return {"expired": expired, "nudged": nudged}


def pending_nudged(db: Session, user_id: str) -> list[str]:
    return list(
        db.scalars(
            select(ConversationRequest.id).where(
                ConversationRequest.requester_id == user_id,
                ConversationRequest.status == RequestStatus.pending,
                ConversationRequest.nudged_at.is_not(None),
            )
        )
    )
