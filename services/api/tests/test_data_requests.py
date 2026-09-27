"""T2.7: the data-request / grievance register (used by the admin panel, T9.11).

It records THAT a request was made and whether it met its deadline — never who made
it. The table has no user, listener, email or conversation column by design; a
request is tied to a person only in the team's own inbox, outside this database.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import inspect, text

from app.models.data_request import DataRequest
from app.models.enums import DataRequestKind, DataRequestStatus

from .conftest import TestSession, requires_postgres, test_engine

pytestmark = requires_postgres

IDENTITY_HINTS = ("user", "listener", "member", "email", "conversation", "owner", "persona")


def test_register_holds_no_identity_columns():
    cols = {c["name"] for c in inspect(test_engine).get_columns("data_requests")}
    assert {"kind", "status", "opened_at", "due_at", "closed_at"} <= cols
    assert not [c for c in cols if any(h in c for h in IDENTITY_HINTS)]


def test_request_opens_and_closes():
    with TestSession() as s:
        s.execute(text("TRUNCATE data_requests"))
        opened = datetime.now(UTC)
        row = DataRequest(
            kind=DataRequestKind.grievance, opened_at=opened, due_at=opened + timedelta(days=30)
        )
        s.add(row)
        s.commit()
        assert row.status == DataRequestStatus.open
        assert row.closed_at is None

        row.status = DataRequestStatus.closed
        row.closed_at = opened + timedelta(days=2)
        s.commit()
        again = s.get(DataRequest, row.id)
        assert again is not None and again.status == DataRequestStatus.closed
        assert again.closed_at is not None and again.closed_at <= again.due_at
