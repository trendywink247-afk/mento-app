"""Push notifications — device registration only (v1 test pass).

Sending is a one-off script (scripts/send_test_push.py), not a product
feature yet; this router just owns the register-token loop so a device can
be found by user id when we want to push to it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import get_db
from app.models.enums import PushOwnerKind
from app.schemas import PushTokenDeleteIn, PushTokenIn
from app.security import current_user_id
from app.services import push

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
    push.upsert_token(db, PushOwnerKind.member, user_id, payload.expo_push_token, payload.platform)
    return {"status": "registered"}


@router.delete("/register-token", response_model=dict)
def delete_token(
    payload: PushTokenDeleteIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> dict:
    """Start Fresh calls this before wiping the session so the old persona's device
    stops receiving anything. Only the owner can remove a token."""
    push.delete_token(db, PushOwnerKind.member, user_id, payload.expo_push_token)
    return {"status": "ok"}
