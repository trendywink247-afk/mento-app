"""Gold mentor invitations (DECISIONS section P.2-3) — see models/mentor_invite.py.

A code is 16 Crockford base32 characters (80 bits) shown in groups of four. Only its SHA-256
is stored; redemption is one UPDATE ... RETURNING so two racing claims cannot both win, and
the route limits guesses per person and per address (failing closed).
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.mentor_invite import MentorInvite

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford: no I, L, O, U
CODE_LENGTH = 16
GROUP = 4
TTL = timedelta(days=7)
_LOOKALIKES = str.maketrans({"O": "0", "I": "1", "L": "1"})


def normalise(raw: str) -> str | None:
    code = "".join(raw.split()).replace("-", "").upper().translate(_LOOKALIKES)
    if len(code) != CODE_LENGTH or any(c not in ALPHABET for c in code):
        return None
    return code


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def create(db: Session, *, note: str | None, admin_id: str | None) -> tuple[MentorInvite, str]:
    """A fresh invite; the caller commits. Returns it with the code, which exists in the clear
    only here and in the admin's one response."""
    code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
    invite = MentorInvite(
        code_hash=_hash(code),
        expires_at=datetime.now(UTC) + TTL,
        note=(note or "").strip() or None,
        created_by=admin_id,
    )
    db.add(invite)
    db.flush()
    return invite, "-".join(code[i : i + GROUP] for i in range(0, CODE_LENGTH, GROUP))


def redeem(db: Session, raw: str, user_id: str) -> str | None:
    """Spend the code for this member: the invite id, or None when it is malformed, unknown,
    expired, revoked or already used. The caller commits."""
    code = normalise(raw)
    if code is None:
        return None
    now = datetime.now(UTC)
    return db.execute(
        update(MentorInvite)
        .where(
            MentorInvite.code_hash == _hash(code),
            MentorInvite.claimed_at.is_(None),
            MentorInvite.revoked_at.is_(None),
            MentorInvite.expires_at > now,
        )
        .values(claimed_at=now, claimed_by=user_id)
        .returning(MentorInvite.id)
    ).scalar_one_or_none()


def status_of(invite: MentorInvite) -> str:
    if invite.claimed_at is not None:
        return "claimed"
    if invite.revoked_at is not None:
        return "revoked"
    exp = invite.expires_at
    exp = exp.replace(tzinfo=UTC) if exp.tzinfo is None else exp
    return "expired" if exp <= datetime.now(UTC) else "open"
