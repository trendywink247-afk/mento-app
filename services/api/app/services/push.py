"""Push notifications (spec 2026-09-05-push-notifications-design.md).

Best-effort, never blocking: a push failure can never delay or degrade a
conversation, the crisis scan, or a request. Content is persona-only — no
message text ever leaves the chat path. Sends go to Expo's push API (FCM/APNs
relay) over httpx.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.enums import PushOwnerKind
from app.models.push_token import PushToken

logger = logging.getLogger("mento.push")

# Test hook (like ratelimit.ENABLED): conftest forces False; push tests flip it True.
ENABLED: bool | None = None


def _enabled() -> bool:
    return ENABLED if ENABLED is not None else get_settings().push_enabled


def upsert_token(
    db: Session, kind: PushOwnerKind, owner_id: str, token: str, platform: str
) -> None:
    """One row per device token: re-point on reinstall or role flip, never duplicate."""
    existing = db.scalars(
        select(PushToken).where(PushToken.expo_push_token == token).limit(1)
    ).first()
    if existing is not None:
        existing.owner_kind = kind
        existing.owner_id = owner_id
        existing.platform = platform
        if kind == PushOwnerKind.member:
            existing.user_id = owner_id
    else:
        db.add(
            PushToken(
                user_id=owner_id,
                owner_kind=kind,
                owner_id=owner_id,
                expo_push_token=token,
                platform=platform,
            )
        )
    db.commit()


def delete_token(db: Session, kind: PushOwnerKind, owner_id: str, token: str) -> None:
    """Remove a device token, but only if the caller owns it (opaque no-op otherwise)."""
    row = db.scalars(
        select(PushToken).where(
            PushToken.expo_push_token == token,
            PushToken.owner_kind == kind,
            PushToken.owner_id == owner_id,
        )
    ).first()
    if row is not None:
        db.delete(row)
        db.commit()


def tokens_for(db: Session, kind: PushOwnerKind, owner_id: str) -> list[str]:
    return list(
        db.scalars(
            select(PushToken.expo_push_token).where(
                PushToken.owner_kind == kind, PushToken.owner_id == owner_id
            )
        ).all()
    )
