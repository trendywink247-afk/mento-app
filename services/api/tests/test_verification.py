"""Mento Verified by document (founder, 2026-11-10): upload, review, wipe."""

from __future__ import annotations

import base64
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models.admin import AdminAccount, AdminAuditLog
from app.models.enums import AdminStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.mentor_document import MentorDocument
from app.security import issue_admin_token, issue_listener_token
from app.services import verification

from .conftest import TestSession, requires_postgres

PDF = b"%PDF-1.4\n%mento test\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 16


@pytest.fixture
def client():
    return TestClient(app)


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _mentor(s, certified=False) -> str:
    li = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=0,
        active_conversations=0,
        max_concurrent=3,
        certified_exam=certified,
    )
    s.add(li)
    s.flush()
    return li.id


def _admin(s) -> str:
    a = AdminAccount(name="Founder", status=AdminStatus.active)
    s.add(a)
    s.flush()
    return a.id


def _l(lid):
    return {"Authorization": f"Bearer {issue_listener_token(lid)}"}


def _a(aid):
    return {"Authorization": f"Bearer {issue_admin_token(aid)}"}


def test_sniff_reads_the_first_bytes_not_the_name():
    assert verification.sniff(PDF) == ("application/pdf", "pdf")
    assert verification.sniff(PNG)[0] == "image/png"
    assert verification.sniff(JPG)[0] == "image/jpeg"
    assert verification.sniff(b"MZ\x90\x00") is None


@requires_postgres
def test_upload_review_approve_marks_verified_and_wipes_the_file(client, db_session):
    with TestSession() as s:
        lid, aid = _mentor(s), _admin(s)
        s.commit()
    up = client.post(
        "/api/v1/listener/me/verification",
        json={"kind": "posting_letter", "content_base64": _b64(PDF)},
        headers=_l(lid),
    )
    assert up.status_code == 201 and up.json()["status"] == "pending"
    doc_id = up.json()["id"]

    queue = client.get("/api/v1/admin/verifications", headers=_a(aid)).json()
    assert [q["id"] for q in queue] == [doc_id] and queue[0]["has_file"] is True
    file = client.get(f"/api/v1/admin/verifications/{doc_id}/file", headers=_a(aid))
    assert file.status_code == 200 and file.content == PDF
    assert file.headers["cache-control"] == "no-store"

    done = client.post(f"/api/v1/admin/verifications/{doc_id}/approve", headers=_a(aid))
    assert done.status_code == 200 and done.json()["status"] == "approved"
    assert done.json()["has_file"] is False
    assert (
        client.get(f"/api/v1/admin/verifications/{doc_id}/file", headers=_a(aid)).status_code == 404
    )

    with TestSession() as s:
        li = s.get(ListenerProfile, lid)
        assert li.certified_exam is True and li.certified_at is not None
        doc = s.get(MentorDocument, doc_id)
        assert doc.content is None and doc.content_deleted_at is not None
        actions = [r.action for r in s.scalars(select(AdminAuditLog)).all()]
        assert "verification.file_viewed" in actions and "verification.approved" in actions
    mine = client.get("/api/v1/listener/me/verification", headers=_l(lid)).json()
    assert mine[0]["status"] == "approved" and "content" not in mine[0]


@requires_postgres
def test_reject_wipes_the_file_and_tells_the_mentor_why(client, db_session):
    with TestSession() as s:
        lid, aid = _mentor(s), _admin(s)
        s.commit()
    doc_id = client.post(
        "/api/v1/listener/me/verification",
        json={"kind": "id_card", "content_base64": _b64(JPG)},
        headers=_l(lid),
    ).json()["id"]
    r = client.post(
        f"/api/v1/admin/verifications/{doc_id}/reject",
        json={"note": "The photo is too dark to read."},
        headers=_a(aid),
    )
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    with TestSession() as s:
        assert s.get(MentorDocument, doc_id).content is None
        assert s.get(ListenerProfile, lid).certified_exam is False
    mine = client.get("/api/v1/listener/me/verification", headers=_l(lid)).json()
    assert mine[0]["status"] == "rejected" and mine[0]["note"] == "The photo is too dark to read."
    # decided: a second decision is refused
    assert (
        client.post(f"/api/v1/admin/verifications/{doc_id}/approve", headers=_a(aid)).status_code
        == 409
    )


@requires_postgres
def test_the_upload_is_checked(client, db_session):
    with TestSession() as s:
        lid, _ = _mentor(s), None
        s.commit()
    send = lambda body: client.post(  # noqa: E731
        "/api/v1/listener/me/verification", json=body, headers=_l(lid)
    )
    assert (
        send({"kind": "id_card", "content_base64": _b64(b"MZ\x90\x00 not a document")}).status_code
        == 422
    )
    assert send({"kind": "id_card", "content_base64": "!!!not base64!!!"}).status_code == 422
    assert send({"kind": "passport", "content_base64": _b64(PDF)}).status_code == 422
    big = PDF + b"0" * (verification.MAX_BYTES + 1)
    assert send({"kind": "id_card", "content_base64": _b64(big)}).status_code == 413
    ok = send({"kind": "id_card", "content_base64": _b64(PNG)})
    assert ok.status_code == 201
    assert send({"kind": "other", "content_base64": _b64(PNG)}).status_code == 409  # one at a time


@requires_postgres
def test_a_verified_mentor_has_nothing_to_send_and_an_admin_is_needed_to_review(client, db_session):
    with TestSession() as s:
        verified = _mentor(s, certified=True)
        s.commit()
    r = client.post(
        "/api/v1/listener/me/verification",
        json={"kind": "id_card", "content_base64": _b64(PDF)},
        headers=_l(verified),
    )
    assert r.status_code == 409 and r.json()["code"] == "already_verified"
    assert client.get("/api/v1/admin/verifications").status_code in (401, 403)


@requires_postgres
def test_unread_files_are_wiped_after_thirty_days(db_session):
    with TestSession() as s:
        lid = _mentor(s)
        old = MentorDocument(
            listener_id=lid, kind="id_card", content_type="image/png", size_bytes=3, content=b"abc"
        )
        fresh = MentorDocument(
            listener_id=lid, kind="other", content_type="image/png", size_bytes=3, content=b"def"
        )
        s.add_all([old, fresh])
        s.flush()
        old.created_at = datetime.now(UTC) - timedelta(days=31)
        s.commit()
        old_id, fresh_id = old.id, fresh.id
    with TestSession() as s:
        assert verification.purge_unread(s) == 1
        s.commit()
    with TestSession() as s:
        assert s.get(MentorDocument, old_id).content is None
        assert s.get(MentorDocument, old_id).status == "expired"
        assert s.get(MentorDocument, fresh_id).content == b"def"


@requires_postgres
def test_mains_admission_card_and_interview_letter_are_accepted_kinds(client, db_session):
    with TestSession() as s:
        lid = _mentor(s)
        s.commit()
    for kind in ("mains_admit_card", "interview_letter"):
        r = client.post(
            "/api/v1/listener/me/verification",
            json={"kind": kind, "content_base64": _b64(JPG)},
            headers=_l(lid),
        )
        assert r.status_code == 201 and r.json()["kind"] == kind
        # one pending at a time: clear it so the next kind can be sent
        with TestSession() as s:
            doc = s.get(MentorDocument, r.json()["id"])
            doc.status = "rejected"
            doc.content = None
            s.commit()
    assert (
        client.post(
            "/api/v1/listener/me/verification",
            json={"kind": "driving_licence", "content_base64": _b64(JPG)},
            headers=_l(lid),
        ).status_code
        == 422
    )
