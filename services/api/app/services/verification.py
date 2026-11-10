"""Becoming Mento Verified by showing a document (founder, 2026-11-10).

A mentor picks what kind of document it is and uploads one file (a photo or a PDF). The founder and
the admins read it and decide. The file is wiped the moment a decision is made, or after 30 days if
nobody has read it; only the fact of it stays. Approval does exactly what an admin's "certify" does.
"""

from __future__ import annotations

import base64
import binascii
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.errors import ApiProblem
from app.models.listener import ListenerProfile
from app.models.mentor_document import MentorDocument

KINDS = ("id_card", "posting_letter", "mains_admit_card", "interview_letter", "result", "other")
MAX_BYTES = 3 * 1024 * 1024  # base64 of this stays under the 5 MB request limit
MAX_ON_FILE = 5  # documents one mentor may have sent in all
UNREAD_DAYS = 30


def sniff(data: bytes) -> tuple[str, str] | None:
    """(content type, extension) from the file's first bytes, or None for anything else."""
    if data.startswith(b"%PDF-"):
        return "application/pdf", "pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg", "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png", "png"
    return None


def submit(
    db: Session, listener: ListenerProfile, kind: str, content_base64: str
) -> MentorDocument:
    if kind not in KINDS:
        raise ApiProblem(422, "bad_kind", "Choose which document this is.")
    if listener.certified_exam:
        raise ApiProblem(409, "already_verified", "You are already Mento Verified.")
    try:
        data = base64.b64decode(content_base64, validate=True)
    except (binascii.Error, ValueError):
        raise ApiProblem(422, "bad_file", "That file could not be read.") from None
    if not data:
        raise ApiProblem(422, "bad_file", "That file is empty.")
    if len(data) > MAX_BYTES:
        raise ApiProblem(413, "too_big", "That file is too large. Please send one under 3 MB.")
    kind_of_file = sniff(data)
    if kind_of_file is None:
        raise ApiProblem(422, "bad_type", "Please send a photo (JPG or PNG) or a PDF.")
    pending = db.scalar(
        select(func.count())
        .select_from(MentorDocument)
        .where(MentorDocument.listener_id == listener.id, MentorDocument.status == "pending")
    )
    if pending:
        raise ApiProblem(409, "already_pending", "Your document is with the team. Please wait.")
    total = db.scalar(
        select(func.count())
        .select_from(MentorDocument)
        .where(MentorDocument.listener_id == listener.id)
    )
    if (total or 0) >= MAX_ON_FILE:
        raise ApiProblem(
            409, "too_many", "You have sent several documents. The team will be in touch."
        )
    doc = MentorDocument(
        listener_id=listener.id,
        kind=kind,
        content_type=kind_of_file[0],
        size_bytes=len(data),
        content=data,
        status="pending",
    )
    db.add(doc)
    db.flush()
    return doc


def wipe(doc: MentorDocument, now: datetime | None = None) -> None:
    doc.content = None
    doc.content_deleted_at = now or datetime.now(UTC)


def decide(
    db: Session,
    doc: MentorDocument,
    *,
    approve: bool,
    admin_id: str,
    note: str | None = None,
) -> None:
    """Record the decision and wipe the file. Approval marks the mentor Mento Verified."""
    now = datetime.now(UTC)
    doc.status = "approved" if approve else "rejected"
    doc.decided_at = now
    doc.decided_by = admin_id
    doc.decision_note = (" ".join(note.split())[:200] if note else None) or None
    wipe(doc, now)
    if approve:
        listener = db.get(ListenerProfile, doc.listener_id)
        if listener is not None:
            listener.certified_exam = True
            listener.certified_at = now


def purge_unread(db: Session, now: datetime | None = None) -> int:
    """Wipe files nobody read within UNREAD_DAYS and mark them expired. Returns how many."""
    now = now or datetime.now(UTC)
    cutoff = now - timedelta(days=UNREAD_DAYS)
    result = db.execute(
        update(MentorDocument)
        .where(MentorDocument.status == "pending", MentorDocument.created_at < cutoff)
        .values(status="expired", content=None, content_deleted_at=now)
    )
    return result.rowcount or 0
