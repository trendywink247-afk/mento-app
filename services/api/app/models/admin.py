"""Admin accounts + an append-only audit log. Admins are the founder and a few
trusted helpers; every mutating action AND every conversation view writes an audit
row. Auth is a role-claimed JWT link (see security.py), revocable per-request."""

from __future__ import annotations

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import AdminRole, AdminStatus
from app.models.mixins import TimestampMixin, UUIDMixin


class AdminAccount(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "admin_accounts"

    name: Mapped[str] = mapped_column(String(64))
    role: Mapped[AdminRole] = mapped_column(default=AdminRole.helper, index=True)
    status: Mapped[AdminStatus] = mapped_column(default=AdminStatus.active, index=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


class AdminAuditLog(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "admin_audit_log"

    admin_id: Mapped[str] = mapped_column(String(36), index=True)
    admin_name: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64), index=True)  # e.g. flag.reviewed
    subject_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    subject_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
