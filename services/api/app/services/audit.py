"""One writer for the admin audit trail. Called by every mutating admin endpoint
AND every conversation view (reads are logged). Never stores message content."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.admin import AdminAccount, AdminAuditLog


def record(
    db: Session,
    admin: AdminAccount,
    action: str,
    *,
    subject_type: str | None = None,
    subject_id: str | None = None,
    meta: dict | None = None,
) -> None:
    db.add(
        AdminAuditLog(
            admin_id=admin.id,
            admin_name=admin.name,
            action=action,
            subject_type=subject_type,
            subject_id=subject_id,
            meta=meta or {},
        )
    )
    # Caller commits (usually alongside the mutation, so audit + action are atomic).
