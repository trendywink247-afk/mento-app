"""Recovery codes (T3.5). An anonymous account has no email or password to fall back
on; a recovery code is the member's own way back on a new phone.

Shape: CODE_LENGTH Crockford base32 characters, shown in groups of four. The first
SELECTOR_LENGTH are a lookup selector stored in the clear (argon2 hashes are salted,
so a hash cannot be looked up); the rest (100 bits) are the secret, stored only as an
argon2id hash. A database read therefore finds a row but cannot sign anyone in.

Typing is forgiven: case, spaces, dashes, and O/0, I/L/1 lookalikes. An unknown
selector still runs one argon2 verify, so timing does not say which half was wrong.
Making a new code replaces the old one; erasing the member takes it with them (the
columns live on the member row).
"""

from __future__ import annotations

import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import User

ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford: no I, L, O, U
CODE_LENGTH = 28
SELECTOR_LENGTH = 8
GROUP = 4
# Guesses per code per hour (the selector is the key: a thief who has half a code
# cannot grind the other half), and per address per quarter hour.
ATTEMPTS_PER_CODE = 5
ATTEMPTS_PER_IP = 10

_hasher = PasswordHasher()
_LOOKALIKES = str.maketrans({"O": "0", "I": "1", "L": "1"})
# A real argon2id hash to verify against when the selector is unknown (same cost).
_DUMMY = _hasher.hash("mento-recovery-dummy")


def normalise(raw: str) -> str | None:
    """The canonical code, or None when it cannot be one."""
    code = "".join(raw.split()).replace("-", "").upper().translate(_LOOKALIKES)
    if len(code) != CODE_LENGTH or any(c not in ALPHABET for c in code):
        return None
    return code


def selector_of(raw: str) -> str | None:
    code = normalise(raw)
    return code[:SELECTOR_LENGTH] if code else None


def issue(user: User) -> str:
    """A fresh code for this member (replacing any older one); the caller commits.
    Returns it formatted for reading — the only time it exists in the clear."""
    code = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
    user.recovery_selector = code[:SELECTOR_LENGTH]
    user.recovery_hash = _hasher.hash(code[SELECTOR_LENGTH:])
    return "-".join(code[i : i + GROUP] for i in range(0, CODE_LENGTH, GROUP))


def find(db: Session, raw: str) -> User | None:
    """The member this code belongs to, or None (wrong, unknown or malformed)."""
    code = normalise(raw)
    if code is None:
        return None
    user = db.scalars(select(User).where(User.recovery_selector == code[:SELECTOR_LENGTH])).first()
    stored = user.recovery_hash if user is not None and user.recovery_hash else _DUMMY
    try:
        _hasher.verify(stored, code[SELECTOR_LENGTH:])
    except (VerificationError, InvalidHashError):
        return None
    return user
