"""The mentor page before you ask shows a mentor's topics in words, never raw slugs:
`GET /listeners/{id}` carries `category_labels` beside `categories`, same order."""

from __future__ import annotations

from datetime import date

from fastapi.testclient import TestClient

from app.main import app
from app.models.enums import ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_session_token

from .conftest import TestSession, requires_postgres


@requires_postgres
def test_profile_carries_member_facing_category_labels(db_session):
    with TestSession() as s:
        u = User(
            persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30
        )
        li = ListenerProfile(
            persona_name="Steady Cedar",
            persona_avatar="owl",
            categories=["exam_stress", "career_doubt", "something_new"],
            status=ListenerStatus.online,
            vetting_status=VettingStatus.approved,
        )
        s.add_all([u, li])
        s.commit()
        uid, lid = u.id, li.id

    r = TestClient(app).get(
        f"/api/v1/listeners/{lid}", headers={"Authorization": f"Bearer {issue_session_token(uid)}"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["categories"] == ["exam_stress", "career_doubt", "something_new"]
    assert body["category_labels"] == ["Exam stress", "Career doubt", "Something new"]
