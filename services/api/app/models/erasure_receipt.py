"""Pseudonymous recovery receipts, not anonymous audit records.

No foreign key: a receipt must survive account deletion. Replication and retention
must cover every recoverable backup before this can establish disaster recovery.
"""
from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import _now


class ErasureReceipt(Base):
    __tablename__ = "erasure_receipts"

    member_digest: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
