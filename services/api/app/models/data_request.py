"""Data requests and grievances (T2.7) — the register the admin panel reads (T9.11).

It records THAT a request came in, what kind, and whether it was answered on time —
never who asked. No user id, listener id, email or conversation id: the person is known
only in the team's own inbox, outside this database, so the register can be shown to a
regulator or kept indefinitely without becoming a list of people who asked.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import DataRequestKind, DataRequestStatus
from app.models.mixins import TimestampMixin, UUIDMixin


class DataRequest(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "data_requests"

    kind: Mapped[DataRequestKind] = mapped_column(index=True)
    status: Mapped[DataRequestStatus] = mapped_column(default=DataRequestStatus.open, index=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # The deadline the team works to; set by whoever opens the row (the rule for each
    # kind lives with the admin tool, T9.11, not in the schema).
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
