"""Sessions and refresh tokens (T3.2).

POST /auth/upgrade — a member holding a long-lived session token (every install that
    predates refresh) swaps it for an access + refresh pair. The old token is not
    revoked: an upgrade interrupted mid-flight must never log anyone out, and it
    expires on its own.
POST /auth/refresh — rotate a refresh token. Reusing one already rotated is treated
    as theft: the whole family is revoked (services/sessions.py).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import get_db
from app.errors import ApiProblem
from app.models.user import User
from app.schemas import RefreshIn, SessionPairOut, UpgradeIn
from app.security import user_token_claims
from app.services import sessions

router = APIRouter(prefix="/auth", tags=["auth"])


def _out(pair: sessions.Pair) -> SessionPairOut:
    return SessionPairOut(
        access_token=pair.access_token,
        refresh_token=pair.refresh_token,
        expires_in=pair.expires_in,
        refresh_expires_at=pair.refresh_expires_at.isoformat(),
    )


@router.post(
    "/upgrade",
    response_model=SessionPairOut,
    responses={409: {"description": "`already_upgraded` — this is already an access token"}},
)
def upgrade(
    payload: UpgradeIn | None = None,
    claims: dict = Depends(user_token_claims),
    db: Session = Depends(get_db),
) -> SessionPairOut:
    user_id = claims["sub"]
    if claims.get("sid"):
        # An access token must not mint a second family (a stolen 15-minute token
        # would become a permanent one).
        raise ApiProblem(
            status.HTTP_409_CONFLICT, "already_upgraded", "This session already refreshes."
        )
    ratelimit.enforce(
        f"auth-upgrade:{user_id}", 10, 3600, detail="Too many tries — please wait a little."
    )
    if db.get(User, user_id) is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown session")
    pair = sessions.start(db, user_id, device_id=payload.device_id if payload else None)
    db.commit()
    return _out(pair)


@router.post("/refresh", response_model=SessionPairOut)
def refresh(payload: RefreshIn, request: Request, db: Session = Depends(get_db)) -> SessionPairOut:
    ratelimit.enforce(
        f"auth-refresh:{ratelimit.client_ip(request)}",
        60,
        600,
        detail="Too many tries — please wait a little.",
    )
    try:
        pair = sessions.rotate(db, payload.refresh_token, device_id=payload.device_id)
    except sessions.SessionInvalid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired session") from None
    return _out(pair)
