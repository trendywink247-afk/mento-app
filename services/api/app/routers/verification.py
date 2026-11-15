"""Mento Verified by document: the mentor's upload and the team's review (founder, 2026-11-10)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import live_events, ratelimit
from app.db import get_db
from app.models.admin import AdminAccount
from app.models.listener import ListenerProfile
from app.models.mentor_document import MentorDocument
from app.routers.admin_console import current_admin
from app.routers.listener_console import current_listener
from app.schemas.verification import (
    AdminVerificationItem,
    VerificationDecisionIn,
    VerificationIn,
    VerificationOut,
)
from app.services import audit, tiers, verification

mentor_router = APIRouter(prefix="/listener/me/verification", tags=["verification"])
admin_router = APIRouter(prefix="/admin/verifications", tags=["admin"])


def _out(d: MentorDocument) -> VerificationOut:
    return VerificationOut(
        id=d.id,
        kind=d.kind,
        status=d.status,
        created_at=d.created_at.isoformat(),
        decided_at=d.decided_at.isoformat() if d.decided_at else None,
        note=d.decision_note,
    )


@mentor_router.get("", response_model=list[VerificationOut])
def my_documents(
    listener: ListenerProfile = Depends(current_listener), db: Session = Depends(get_db)
) -> list[VerificationOut]:
    """This mentor's documents and where each stands. Never the file."""
    rows = db.scalars(
        select(MentorDocument)
        .where(MentorDocument.listener_id == listener.id)
        .order_by(MentorDocument.created_at.desc())
    ).all()
    return [_out(d) for d in rows]


@mentor_router.post("", response_model=VerificationOut, status_code=status.HTTP_201_CREATED)
def send_document(
    payload: VerificationIn,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> VerificationOut:
    ratelimit.enforce(
        f"verification:{listener.id}",
        5,
        86400,
        detail="That is a lot of uploads in a day. Please try again tomorrow.",
    )
    doc = verification.submit(db, listener, payload.kind, payload.content_base64)
    db.commit()
    db.refresh(doc)
    return _out(doc)


def _item(d: MentorDocument, persona_name: str) -> AdminVerificationItem:
    return AdminVerificationItem(
        id=d.id,
        listener_id=d.listener_id,
        persona_name=persona_name,
        kind=d.kind,
        content_type=d.content_type,
        size_bytes=d.size_bytes,
        status=d.status,
        created_at=d.created_at.isoformat(),
        decided_at=d.decided_at.isoformat() if d.decided_at else None,
        has_file=d.content is not None,
    )


@admin_router.get("", response_model=list[AdminVerificationItem])
def review_queue(
    status_filter: str = "pending",
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[AdminVerificationItem]:
    rows = db.execute(
        select(MentorDocument, ListenerProfile.persona_name)
        .join(ListenerProfile, ListenerProfile.id == MentorDocument.listener_id)
        .where(MentorDocument.status == status_filter)
        .order_by(MentorDocument.created_at.asc())
        .limit(100)
    ).all()
    return [_item(d, name) for d, name in rows]


@admin_router.get("/{doc_id}/file")
def read_file(
    doc_id: str, admin: AdminAccount = Depends(current_admin), db: Session = Depends(get_db)
) -> Response:
    """The file itself, for the reviewing admin only. Every read is written to the audit log."""
    doc = db.get(MentorDocument, doc_id)
    if doc is None or doc.content is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no file")
    audit.record(
        db,
        admin,
        "verification.file_viewed",
        subject_type="listener",
        subject_id=doc.listener_id,
        meta={"document": doc.id, "kind": doc.kind},
    )
    db.commit()
    return Response(
        content=doc.content,
        media_type=doc.content_type,
        headers={"Cache-Control": "no-store", "Content-Disposition": "inline"},
    )


def _decide(
    doc_id: str,
    approve: bool,
    payload: VerificationDecisionIn | None,
    admin: AdminAccount,
    db: Session,
) -> AdminVerificationItem:
    doc = db.get(MentorDocument, doc_id, with_for_update=True)
    if doc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found")
    if doc.status != "pending":
        raise HTTPException(status.HTTP_409_CONFLICT, "already decided")
    # DECISIONS R.4 (option b): omitted grant = Mento Verified, as older admin builds expect.
    grant = (payload.grant if payload else None) or tiers.VERIFIED
    counts = (
        {"prelims": payload.prelims, "mains": payload.mains, "interview": payload.interview}
        if payload
        and any(v is not None for v in (payload.prelims, payload.mains, payload.interview))
        else None
    )
    exam_history = {k: v or 0 for k, v in counts.items()} if counts else None
    if approve:
        try:
            verification.check_grant(grant, exam_history)
        except tiers.TierError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    verification.decide(
        db,
        doc,
        approve=approve,
        admin_id=admin.id,
        note=payload.note if payload else None,
        grant=grant,
        exam_history=exam_history,
    )
    live_events.review_decided(db, listener_id=doc.listener_id)  # sent on commit
    audit.record(
        db,
        admin,
        "verification.approved" if approve else "verification.rejected",
        subject_type="listener",
        subject_id=doc.listener_id,
        meta={"document": doc.id, "kind": doc.kind, **({"grant": grant} if approve else {})},
    )
    li = db.get(ListenerProfile, doc.listener_id)
    db.commit()
    db.refresh(doc)
    return _item(doc, li.persona_name if li else "")


@admin_router.post("/{doc_id}/approve", response_model=AdminVerificationItem)
def approve(
    doc_id: str,
    payload: VerificationDecisionIn | None = None,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminVerificationItem:
    """Approve the document and wipe the file: Mento Verified, or Mentor with `grant`."""
    return _decide(doc_id, True, payload, admin, db)


@admin_router.post("/{doc_id}/reject", response_model=AdminVerificationItem)
def reject(
    doc_id: str,
    payload: VerificationDecisionIn | None = None,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminVerificationItem:
    """Say no (with a short reason the mentor sees) and wipe the file."""
    return _decide(doc_id, False, payload, admin, db)
