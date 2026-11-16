"""DECISIONS T.8: answer evaluations behind evaluations_enabled. Photos only, an automatic check,
no money, anonymity both ways, and real deletion (withdraw, sweep, Clean Wipe)."""

from __future__ import annotations

import base64
import struct
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import get_settings
from app.main import app
from app.models.answer_evaluation import AnswerEvaluation, AnswerPage
from app.models.listener import ListenerProfile
from app.models.safety import SafetyFlag
from app.services import evaluations, stream

from .chat_helpers import seed_chat
from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres

API = "/api/v1"


def _jpeg_with_exif() -> bytes:
    exif = b"Exif\x00\x00GPS 12.97N 77.59E my-phone-serial"
    app1 = b"\xff\xe1" + struct.pack(">H", len(exif) + 2) + exif
    jfif = b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    app0 = b"\xff\xe0" + struct.pack(">H", len(jfif) + 2) + jfif
    com = b"\xff\xfe" + struct.pack(">H", 9) + b"comment"
    scan = b"\xff\xda" + struct.pack(">H", 2) + b"\x12\x34\x56\xff\xd9"
    return b"\xff\xd8" + app0 + app1 + com + scan


def _png_with_text() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + b"\x00\x00\x00\x00"

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", b"\x00" * 13)
        + chunk(b"tEXt", b"Author\x00Real Name")
        + chunk(b"IDAT", b"\x01\x02")
        + chunk(b"IEND", b"")
    )


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(get_settings(), "evaluations_enabled", True)
    monkeypatch.setattr(get_settings(), "rate_limit_enabled", False)


def _mentor(db_session, s, tier="mentor"):
    li = db_session.get(ListenerProfile, s.mentor_id)
    li.tier = tier
    db_session.commit()


def _sent(client, s, *, audience="everyone", listener_id=None, note=None, kind="mains"):
    member = {"Authorization": f"Bearer {s.member}"}
    body = {"kind": kind, "audience": audience, "question": "Discuss federalism.", "note": note}
    if listener_id:
        body["listener_id"] = listener_id
    r = client.post(f"{API}/evaluations", json=body, headers=member)
    assert r.status_code == 201, r.text
    ev_id = r.json()["id"]
    p = client.post(
        f"{API}/evaluations/{ev_id}/pages",
        json={"content_base64": _b64(_jpeg_with_exif())},
        headers=member,
    )
    assert p.status_code == 200 and p.json() == {"pages": 1}, p.text
    sent = client.post(f"{API}/evaluations/{ev_id}/send", headers=member)
    assert sent.status_code == 200, sent.text
    return ev_id, sent.json()


def test_switched_off_everything_is_404(client, db_session):
    s = seed_chat(db_session)
    assert (
        client.get(
            f"{API}/evaluations", headers={"Authorization": f"Bearer {s.member}"}
        ).status_code
        == 404
    )
    assert (
        client.get(
            f"{API}/listener/me/evaluations", headers={"Authorization": f"Bearer {s.mentor}"}
        ).status_code
        == 404
    )
    e = client.get(f"{API}/listener/me/earnings", headers={"Authorization": f"Bearer {s.mentor}"})
    assert e.json()["evaluations_live"] is False


def test_send_claim_return_with_anonymity_and_clean_photos(client, db_session, on):
    s = seed_chat(db_session)
    _mentor(db_session, s)
    member = {"Authorization": f"Bearer {s.member}"}
    mentor = {"Authorization": f"Bearer {s.mentor}"}
    ev_id, out = _sent(client, s)
    assert out["status"] == "open" and out["pages"] == 1 and out.get("support") is None

    q = client.get(f"{API}/listener/me/evaluations", headers=mentor)
    assert q.status_code == 200 and [x["id"] for x in q.json()] == [ev_id]
    # Nothing about the member, anywhere in the mentor's view.
    assert s.member_id not in q.text and "Quiet Cove" not in q.text
    assert q.json()[0]["payout_paise"] == 4000 and q.json()[0]["personal"] is False

    photo = client.get(f"{API}/listener/me/evaluations/{ev_id}/pages/0", headers=mentor)
    assert photo.status_code == 200 and photo.headers["content-type"] == "image/jpeg"
    assert b"Exif" not in photo.content and b"GPS" not in photo.content
    assert b"comment" not in photo.content and b"JFIF" in photo.content
    assert photo.content.endswith(b"\xff\xd9")

    c = client.post(f"{API}/listener/me/evaluations/{ev_id}/claim", headers=mentor)
    assert c.status_code == 200 and c.json()["status"] == "claimed" and c.json()["due_at"]

    # Another mentor cannot see it any more, nor take it.
    other = seed_chat(db_session)
    _mentor(db_session, other)
    them = {"Authorization": f"Bearer {other.mentor}"}
    assert client.get(f"{API}/listener/me/evaluations", headers=them).json() == []
    assert (
        client.post(f"{API}/listener/me/evaluations/{ev_id}/claim", headers=them).status_code == 404
    )
    assert (
        client.get(f"{API}/listener/me/evaluations/{ev_id}/pages/0", headers=them).status_code
        == 404
    )

    short = client.post(
        f"{API}/listener/me/evaluations/{ev_id}/return", json={"feedback": "Good."}, headers=mentor
    )
    assert short.status_code == 422
    words = "Strong intro. Add one example from the constitution and close with a way forward."
    done = client.post(
        f"{API}/listener/me/evaluations/{ev_id}/return", json={"feedback": words}, headers=mentor
    )
    assert done.status_code == 200 and done.json()["payout_paise"] == 4000

    mine = client.get(f"{API}/evaluations", headers=member).json()
    assert mine[0]["status"] == "returned" and mine[0]["feedback"] == words
    assert mine[0]["mentor_name"] == "Open River"
    e = client.get(f"{API}/listener/me/earnings", headers=mentor).json()
    assert e["completed_evaluations"] == 1 and e["evaluation_paise"] == 4000
    assert e["balance_paise"] == 0 and e["payments_live"] is False


def test_personal_goes_only_to_that_mentor_and_only_to_mentors(client, db_session, on):
    s = seed_chat(db_session)  # its mentor stays a peer listener
    member = {"Authorization": f"Bearer {s.member}"}
    r = client.post(
        f"{API}/evaluations",
        json={"kind": "mains", "audience": "one", "listener_id": s.mentor_id},
        headers=member,
    )
    assert r.status_code == 422
    # A peer listener never sees answers sent to everyone either.
    _sent(client, s)
    assert (
        client.get(
            f"{API}/listener/me/evaluations", headers={"Authorization": f"Bearer {s.mentor}"}
        ).json()
        == []
    )

    chosen = seed_chat(db_session)
    _mentor(db_session, chosen, tier="mentor")
    bystander = seed_chat(db_session)
    _mentor(db_session, bystander, tier="mentor")
    ev_id, out = _sent(client, s, audience="one", listener_id=chosen.mentor_id)
    assert out["mentor_name"] == "Open River"
    see = lambda who: [  # noqa: E731
        x["id"]
        for x in client.get(
            f"{API}/listener/me/evaluations", headers={"Authorization": f"Bearer {who.mentor}"}
        ).json()
    ]
    assert ev_id in see(chosen) and ev_id not in see(bystander)


def test_photos_only_and_metadata_stripped_from_png(client, db_session, on):
    s = seed_chat(db_session)
    member = {"Authorization": f"Bearer {s.member}"}
    ev_id = client.post(f"{API}/evaluations", json={"kind": "mains"}, headers=member).json()["id"]
    for bad in (b"%PDF-1.4 hello", b"GIF89a....", b"\xff\xd8\xff\xe1\x00"):
        r = client.post(
            f"{API}/evaluations/{ev_id}/pages", json={"content_base64": _b64(bad)}, headers=member
        )
        assert r.status_code == 422, bad
    nothing = client.post(f"{API}/evaluations/{ev_id}/send", headers=member)
    assert nothing.status_code == 422
    ok = client.post(
        f"{API}/evaluations/{ev_id}/pages",
        json={"content_base64": _b64(_png_with_text())},
        headers=member,
    )
    assert ok.status_code == 200
    page = client.get(f"{API}/evaluations/{ev_id}/pages/0", headers=member)
    assert b"Real Name" not in page.content and b"IDAT" in page.content and b"IEND" in page.content
    # Someone else's evaluation is simply not there.
    other = seed_chat(db_session)
    assert (
        client.get(
            f"{API}/evaluations/{ev_id}/pages/0",
            headers={"Authorization": f"Bearer {other.member}"},
        ).status_code
        == 404
    )


def test_crisis_words_still_send_and_bring_the_helplines(client, db_session, on):
    s = seed_chat(db_session)
    _ev, out = _sent(client, s, note="I want to end my life")
    assert out["status"] == "open" and out["support"]["helplines"]
    db_session.expire_all()
    flags = db_session.scalars(select(SafetyFlag).where(SafetyFlag.user_id == s.member_id)).all()
    assert len(flags) == 1


def test_withdraw_and_sweep_wipe_photos(client, db_session, on):
    s = seed_chat(db_session)
    _mentor(db_session, s)
    member = {"Authorization": f"Bearer {s.member}"}
    a, _ = _sent(client, s)
    w = client.delete(f"{API}/evaluations/{a}", headers=member)
    assert w.status_code == 200 and w.json()["status"] == "withdrawn"
    assert w.json()["pages_available"] is False

    b, _ = _sent(client, s)
    c, _ = _sent(client, s)
    mentor = {"Authorization": f"Bearer {s.mentor}"}
    client.post(f"{API}/listener/me/evaluations/{c}/claim", headers=mentor)
    later = datetime.now(UTC) + timedelta(days=evaluations.OPEN_DAYS + 1)
    with TestSession() as db:
        counts = evaluations.sweep(db, now=later)
        db.commit()
    assert counts["expired"] == 1 and counts["reopened"] == 1
    with TestSession() as db:
        assert db.get(AnswerEvaluation, b).status == "expired"
        assert db.get(AnswerEvaluation, c).status == "open"
        assert db.get(AnswerEvaluation, c).listener_id is None
        for ev in (a, b):
            pages = db.scalars(select(AnswerPage).where(AnswerPage.evaluation_id == ev)).all()
            assert pages and all(p.content is None for p in pages)


def test_clean_wipe_removes_evaluations_and_photos(client, db_session, on, monkeypatch):
    monkeypatch.setattr(stream, "wipe_channel", lambda _cid: None)
    monkeypatch.setattr(stream, "delete_user", lambda _uid: None)
    s = seed_chat(db_session)
    _mentor(db_session, s)
    ev_id, _ = _sent(client, s)
    r = client.delete(f"{API}/me", headers={"Authorization": f"Bearer {s.member}"})
    assert r.status_code == 200, r.text
    with TestSession() as db:
        assert db.get(AnswerEvaluation, ev_id) is None
        assert db.scalars(select(AnswerPage).where(AnswerPage.evaluation_id == ev_id)).all() == []


def test_payout_falls_with_turnaround():
    t0 = datetime(2026, 11, 16, tzinfo=UTC)
    assert evaluations.payout_for("mains", t0, t0 + timedelta(hours=20)) == 4000
    assert evaluations.payout_for("mains", t0, t0 + timedelta(hours=50)) == 3500
    assert evaluations.payout_for("mains", t0, t0 + timedelta(days=5)) == 3000
    assert evaluations.payout_for("essay", t0, t0 + timedelta(hours=40)) == 50000
    assert evaluations.payout_for("essay", t0, t0 + timedelta(days=3)) == 40000
    assert evaluations.payout_for("essay", t0, t0 + timedelta(days=9)) == 30000
