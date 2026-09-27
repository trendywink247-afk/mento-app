"""One-time mentor console codes (T3.10) — see models/console_code.py."""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.console_code import ConsoleCode

CODE_TTL = timedelta(minutes=10)


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def mint(db: Session, listener_id: str) -> tuple[str, datetime]:
    """A fresh code for this mentor; the caller commits. Returns (code, expires_at)."""
    code = secrets.token_urlsafe(24)
    expires_at = datetime.now(UTC) + CODE_TTL
    db.add(ConsoleCode(listener_id=listener_id, code_hash=_hash(code), expires_at=expires_at))
    return code, expires_at


def redeem(db: Session, code: str) -> str | None:
    """Spend a code: the mentor's listener id, or None when it is unknown, expired or
    already used. One UPDATE … RETURNING, so two racing trades cannot both win.
    The caller commits."""
    now = datetime.now(UTC)
    return db.execute(
        update(ConsoleCode)
        .where(
            ConsoleCode.code_hash == _hash(code),
            ConsoleCode.used_at.is_(None),
            ConsoleCode.expires_at > now,
        )
        .values(used_at=now)
        .returning(ConsoleCode.listener_id)
    ).scalar_one_or_none()
