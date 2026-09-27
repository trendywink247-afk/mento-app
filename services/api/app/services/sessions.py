"""Refresh-token sessions (T3.2) — see models/session.py for the shape.

Rotation holds a row lock on the presented token, so two concurrent refreshes with
the same token cannot both succeed: the second waits, finds it revoked, and is
treated as reuse. The app single-flights its refreshes so a legitimate client never
races itself (lib/api.ts).
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.session import Session as AuthSession
from app.models.user import User
from app.security import issue_access_token

TOKEN_PREFIX = "mr1."


class SessionInvalid(Exception):
    """Unknown, expired, revoked or reused refresh token — the caller answers 401."""


@dataclass(frozen=True)
class Pair:
    access_token: str
    refresh_token: str
    expires_in: int
    refresh_expires_at: datetime
    user_id: str


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(UTC)


def _aware(at: datetime) -> datetime:
    return at.replace(tzinfo=UTC) if at.tzinfo is None else at


def _issue(
    db: Session,
    user_id: str,
    family_id: str,
    *,
    device_id: str | None,
    rotated_from: str | None,
) -> Pair:
    settings = get_settings()
    raw = TOKEN_PREFIX + secrets.token_urlsafe(32)
    expires_at = _now() + timedelta(days=settings.refresh_token_ttl_days)
    db.add(
        AuthSession(
            user_id=user_id,
            family_id=family_id,
            jti=uuid.uuid4().hex,
            token_hash=_hash(raw),
            device_id=device_id,
            rotated_from=rotated_from,
            expires_at=expires_at,
        )
    )
    return Pair(
        access_token=issue_access_token(user_id, family_id),
        refresh_token=raw,
        expires_in=settings.access_token_minutes * 60,
        refresh_expires_at=expires_at,
        user_id=user_id,
    )


def start(db: Session, user_id: str, *, device_id: str | None = None) -> Pair:
    """Open a new family for a member. The caller commits."""
    return _issue(db, user_id, str(uuid.uuid4()), device_id=device_id, rotated_from=None)


def revoke_family(db: Session, family_id: str) -> None:
    db.execute(
        update(AuthSession)
        .where(AuthSession.family_id == family_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


def revoke_all(db: Session, user_id: str) -> None:
    """Every session this member has (recovery signs everything else out)."""
    db.execute(
        update(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
        .values(revoked_at=_now())
    )


def rotate(db: Session, raw: str, *, device_id: str | None = None) -> Pair:
    """Swap a refresh token for a new pair; commits. Reuse revokes the family (and
    commits that) before raising, so the theft response survives the 401."""
    row = db.scalars(
        select(AuthSession).where(AuthSession.token_hash == _hash(raw)).with_for_update()
    ).first()
    if row is None:
        db.rollback()
        raise SessionInvalid
    if row.revoked_at is not None:
        revoke_family(db, row.family_id)
        db.commit()
        raise SessionInvalid
    if _aware(row.expires_at) <= _now() or db.get(User, row.user_id) is None:
        db.rollback()
        raise SessionInvalid
    row.revoked_at = _now()
    pair = _issue(
        db,
        row.user_id,
        row.family_id,
        device_id=device_id or row.device_id,
        rotated_from=row.id,
    )
    db.commit()
    return pair
