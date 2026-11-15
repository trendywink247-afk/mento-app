"""Confirm a member's email with a six-digit code (DECISIONS R.10).

Start stores the address as pending with the code hashed; confirm copies it to
users.email and stamps users.email_verified_at. Five wrong tries or fifteen minutes
end a code; the member asks for a new one."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.email_confirmation import EmailConfirmation
from app.models.user import User
from app.services import email_sender

CODE_TTL = timedelta(minutes=15)
MAX_ATTEMPTS = 5


def _hash(user_id: str, code: str) -> str:
    return hashlib.sha256(f"{user_id}:{code}".encode()).hexdigest()


def start(db: Session, user: User, email: str) -> None:
    code = f"{secrets.randbelow(1_000_000):06d}"
    row = db.get(EmailConfirmation, user.id)
    expires = datetime.now(UTC) + CODE_TTL
    if row is None:
        db.add(
            EmailConfirmation(
                user_id=user.id, email=email, code_hash=_hash(user.id, code), expires_at=expires
            )
        )
    else:
        row.email, row.code_hash, row.expires_at, row.attempts = (
            email,
            _hash(user.id, code),
            expires,
            0,
        )
    db.flush()
    email_sender.send_code(email, code)


class Wrong(Exception):
    """Wrong, expired or used up — the message is the same for each (no oracle)."""


def confirm(db: Session, user: User, code: str) -> None:
    row = db.get(EmailConfirmation, user.id, with_for_update=True)
    if row is None or row.expires_at < datetime.now(UTC) or row.attempts >= MAX_ATTEMPTS:
        raise Wrong()
    if not hmac.compare_digest(row.code_hash, _hash(user.id, code.strip())):
        row.attempts += 1
        db.commit()
        raise Wrong()
    user.email = row.email
    user.email_verified_at = datetime.now(UTC)
    db.delete(row)
