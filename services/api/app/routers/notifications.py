"""Push notifications — device registration only (v1 test pass).

Sending is a one-off script (scripts/send_test_push.py), not a product
feature yet; this router just owns the register-token loop so a device can
be found by user id when we want to push to it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import get_db
from app.models.push_token import PushToken
from app.schemas import PushTokenIn
from app.security import current_user_id

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.post("/register-token", response_model=dict)
def register_token(
    payload: PushTokenIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> dict:
    # Reinstall/re-onboard churn on one device, not abuse — generous window.
    ratelimit.enforce(
        f"push-token:{user_id}",
        20,
        3600,
        detail="Too many token registrations — please wait a moment.",
    )
    # Upsert by token value: a device that lands on a new anonymous user_id
    # (reinstall) re-points the existing row instead of leaving a stale duplicate.
    existing = db.scalars(
        select(PushToken).where(PushToken.expo_push_token == payload.expo_push_token).limit(1)
    ).first()
    if existing is not None:
        existing.user_id = user_id
        existing.platform = payload.platform
    else:
        db.add(
            PushToken(
                user_id=user_id,
                expo_push_token=payload.expo_push_token,
                platform=payload.platform,
            )
        )
    db.commit()
    return {"status": "registered"}
