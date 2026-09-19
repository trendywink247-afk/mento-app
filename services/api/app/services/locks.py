"""Per-member serialisation for check-then-insert writes.

Several member writes are "look for an existing row, otherwise insert" with no unique
key to lean on (a Mentor Note keyed by a JSON field, one pending request per pair, one
live application per member). Two concurrent calls — a double tap, a client retry —
both pass the check and both insert. Taking the member's own row FOR UPDATE first
makes the second call wait for the first to commit, then see its row.

Cheap (one indexed row, held for one short transaction), deadlock-free (always the
first lock taken, only ever one member's row) and a no-op on the SQLite dev fallback,
exactly like the matcher's locks.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.user import User


def serialize_member(db: Session, user_id: str) -> None:
    """Hold this member's row until the caller's transaction ends."""
    db.execute(select(User.id).where(User.id == user_id).with_for_update()).first()
