"""Moderation review queue (PRD §11). Minimal human-review surface until the full
moderation console (Module C) ships: reported/blocked events land here as unreviewed.

Guarded by a static admin token (settings.admin_token). If no token is configured the
queue is disabled — reports are still filed, just not exposed over HTTP.
"""
from __future__ import annotations

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models.moderation import ModerationEvent
from app.schemas import ModerationItem, OkResult

router = APIRouter(prefix="/moderation", tags=["moderation"])


def _require_admin(x_admin_token: str | None = Header(default=None)) -> None:
    token = get_settings().admin_token
    if not token or not hmac.compare_digest(x_admin_token or "", token):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin token required")


def _item(e: ModerationEvent) -> ModerationItem:
    return ModerationItem(
        id=e.id,
        reporter_id=e.reporter_id,
        subject_id=e.subject_id,
        conversation_id=e.conversation_id,
        level=int(e.level.value),
        reason=e.reason,
        blocked=e.blocked,
        reviewed=e.reviewed,
        created_at=e.created_at.isoformat(),
    )


@router.get("/queue", response_model=list[ModerationItem], dependencies=[Depends(_require_admin)])
def review_queue(db: Session = Depends(get_db)) -> list[ModerationItem]:
    """Unreviewed reports/blocks, newest first — what a human reviewer works through."""
    events = (
        db.execute(
            select(ModerationEvent)
            .where(ModerationEvent.reviewed.is_(False))
            .order_by(ModerationEvent.created_at.desc())
        )
        .scalars()
        .all()
    )
    return [_item(e) for e in events]


@router.post(
    "/{event_id}/resolve", response_model=OkResult, dependencies=[Depends(_require_admin)]
)
def resolve(event_id: str, db: Session = Depends(get_db)) -> OkResult:
    event = db.get(ModerationEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    event.reviewed = True
    event.reviewed_by = "admin"
    db.commit()
    return OkResult(status="resolved")
