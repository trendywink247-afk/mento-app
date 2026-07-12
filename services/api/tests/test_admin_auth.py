"""Admin auth: role isolation (user/listener/admin mutually reject) + per-request
revocation (status=revoked kills outstanding links immediately)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.admin import AdminAccount
from app.models.enums import AdminRole, AdminStatus
from app.security import issue_admin_token, issue_listener_token, issue_session_token

from .conftest import requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


def _seed_admin(s, *, role=AdminRole.owner, status=AdminStatus.active) -> str:
    a = AdminAccount(name="Founder", role=role, status=status)
    s.add(a)
    s.flush()
    return a.id


@requires_postgres
def test_admin_token_opens_admin_only(client, db_session):
    admin_id = _seed_admin(db_session)
    db_session.commit()
    ok = client.get(
        "/api/v1/admin/me", headers={"Authorization": f"Bearer {issue_admin_token(admin_id)}"}
    )
    assert ok.status_code == 200 and ok.json()["role"] == "owner"
    # A user or listener token must NOT open an admin endpoint.
    assert (
        client.get(
            "/api/v1/admin/me",
            headers={"Authorization": f"Bearer {issue_session_token('u1')}"},
        ).status_code
        == 401
    )
    assert (
        client.get(
            "/api/v1/admin/me",
            headers={"Authorization": f"Bearer {issue_listener_token('l1')}"},
        ).status_code
        == 401
    )


@requires_postgres
def test_revoked_admin_is_rejected_immediately(client, db_session):
    admin_id = _seed_admin(db_session, status=AdminStatus.revoked)
    db_session.commit()
    r = client.get(
        "/api/v1/admin/me", headers={"Authorization": f"Bearer {issue_admin_token(admin_id)}"}
    )
    assert r.status_code == 403
