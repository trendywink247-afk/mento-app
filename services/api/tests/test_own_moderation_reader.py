"""Own transport obeys the existing audited live-case reader contract."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.models.admin import AdminAccount
from app.models.chat_message import ChatMessage
from app.models.conversation import Conversation
from app.models.enums import (
    AdminRole,
    AdminStatus,
    ConversationStatus,
    ModerationLevel,
    ReporterKind,
)
from app.models.moderation import ModerationEvent
from app.security import issue_listener_token, issue_session_token
from app.services import chat, message_crypto

from . import test_admin_scope as scope
from .conftest import requires_postgres
from .test_admin_scope import REASON, _read, _views, _world


@pytest.fixture
def client():
    return scope.TestClient(scope.app)


@pytest.fixture(autouse=True)
def fetched(monkeypatch):
    calls = []

    def fetch(cid):
        calls.append(cid)
        pytest.fail("own room reached Stream")

    monkeypatch.setattr(scope.stream, "fetch_channel_messages", fetch)
    return calls


def _seed(db, *, role=AdminRole.helper):
    aid, uid, lid, cid = _world(db, "own")
    db.get(AdminAccount, aid).role = role
    db.add(
        ModerationEvent(
            reporter_id=uid,
            reporter_kind=ReporterKind.member,
            subject_id=lid,
            conversation_id=cid,
            level=ModerationLevel.warning,
            reason="harassment",
        )
    )
    return aid, uid, lid, cid


def _message(db, cid, uid, seq, *, text="redacted safe text", kind="member"):
    mid = str(uuid4())
    body, key = message_crypto.encrypt(text, message_id=mid, conversation_id=cid)
    row = ChatMessage(
        id=mid,
        conversation_id=cid,
        sender_id=uid,
        sender_kind=kind,
        seq=seq,
        client_id=f"test-{seq}",
        body=body,
        key_id=key,
        redacted=True,
        created_at=datetime.now(UTC) + timedelta(microseconds=seq),
    )
    db.add(row)
    return row


@requires_postgres
@pytest.mark.parametrize("role", [AdminRole.owner, AdminRole.helper])
def test_encrypted_live_read_only_personas_and_same_audit(client, db_session, fetched, role):
    aid, uid, lid, cid = _seed(db_session, role=role)
    _message(db_session, cid, uid, 1)
    _message(db_session, cid, lid, 2, kind="mentor", text="mentor reply")
    db_session.commit()
    response = _read(client, aid, cid)
    assert response.status_code == 200
    rows = response.json()
    assert [m["user_persona"] for m in rows] == ["Quiet Cove", "Open River"]
    assert [m["text"] for m in rows] == ["redacted safe text", "mentor reply"]
    assert all(set(m) == {"id", "text", "user_persona", "at"} for m in rows)
    assert uid not in response.text and lid not in response.text
    assert fetched == []
    (audit,) = _views(cid)
    assert audit.meta == {"reason": REASON, "case": "report"}
    assert "safe text" not in str(audit.meta)


@requires_postgres
def test_real_send_redaction_reader_returns_only_stored_delivery_text(
    client, db_session, fetched, monkeypatch
):
    aid, _, lid, cid = _seed(db_session)
    db_session.commit()
    # Only asynchronous delivery effects are stubbed: the actual standing, scan,
    # allowance, redaction, encryption and persistence pipeline executes.
    monkeypatch.setattr(chat, "publish", lambda *args, **kwargs: None)
    monkeypatch.setattr(chat, "enqueue_after_send", lambda *args, **kwargs: None)
    original = "Contact synthetic@example.invalid"
    sent = chat.send(db_session, lid, cid, client_id="moderation-real-send", body=original)
    assert sent.message["text"] == "Contact [email hidden]"
    assert sent.message["moderation"] == {"redacted": True}
    response = _read(client, aid, cid)
    assert response.status_code == 200
    assert response.json()[0]["text"] == sent.message["text"]
    assert "synthetic@example.invalid" not in response.text
    assert fetched == []


@requires_postgres
def test_latest_100_only_in_chronological_order_and_other_room_excluded(
    client, db_session, fetched
):
    aid, uid, lid, cid = _seed(db_session)
    for seq in range(1, 104):
        _message(db_session, cid, uid, seq, text=f"message {seq}")
    other = Conversation(type="anon", user_id=uid, listener_id=lid, chat_backend="own")
    db_session.add(other)
    db_session.flush()
    _message(db_session, other.id, uid, 999, text="other room private")
    db_session.commit()
    rows = _read(client, aid, cid).json()
    assert [m["text"] for m in rows] == [f"message {n}" for n in range(4, 104)]
    assert fetched == []


@requires_postgres
def test_wiped_room_cannot_resurrect_even_leftover_ciphertext(
    client, db_session, fetched, monkeypatch
):
    aid, uid, _, cid = _seed(db_session)
    _message(db_session, cid, uid, 1)
    db_session.get(Conversation, cid).status = ConversationStatus.wiped
    db_session.commit()
    monkeypatch.setattr(message_crypto, "decrypt", lambda *a, **k: pytest.fail("wiped decrypt"))
    assert _read(client, aid, cid).json() == []
    assert fetched == []


@requires_postgres
@pytest.mark.parametrize("credential", ["member", "mentor", "revoked"])
def test_invalid_staff_never_decrypts(client, db_session, monkeypatch, fetched, credential):
    aid, uid, lid, cid = _seed(db_session)
    _message(db_session, cid, uid, 1)
    if credential == "revoked":
        db_session.get(AdminAccount, aid).status = AdminStatus.revoked
    db_session.commit()
    monkeypatch.setattr(
        message_crypto, "decrypt", lambda *a, **k: pytest.fail("unauthorized decrypt")
    )
    if credential == "revoked":
        response = _read(client, aid, cid)
        assert response.status_code == 403
    else:
        token = issue_session_token(uid) if credential == "member" else issue_listener_token(lid)
        response = client.get(
            f"/api/v1/admin/conversations/{cid}/messages",
            params={"reason": REASON},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 401
    assert fetched == []
    assert _views(cid) == []


@requires_postgres
@pytest.mark.parametrize("state", ["resolved", "deleted", "ended"])
def test_live_case_and_surviving_rows_bound_retention(
    client, db_session, fetched, monkeypatch, state
):
    aid, uid, _, cid = _seed(db_session)
    row = _message(db_session, cid, uid, 1)
    if state == "resolved":
        db_session.flush()
        db_session.query(ModerationEvent).filter_by(conversation_id=cid).one().reviewed = True
    elif state == "deleted":
        db_session.flush()
        db_session.delete(row)
    else:
        db_session.get(Conversation, cid).status = ConversationStatus.ended
    db_session.commit()
    if state in {"resolved", "deleted"}:
        monkeypatch.setattr(
            message_crypto, "decrypt", lambda *a, **k: pytest.fail("unavailable decrypt")
        )
    response = _read(client, aid, cid)
    assert response.status_code == (403 if state == "resolved" else 200)
    if state == "deleted":
        assert response.json() == []
    if state == "ended":
        assert response.json()[0]["text"] == "redacted safe text"
    assert len(_views(cid)) == (0 if state == "resolved" else 1)


@requires_postgres
def test_tampered_ciphertext_returns_no_partial_plaintext_and_is_audited(
    client, db_session, fetched
):
    aid, uid, _, cid = _seed(db_session)
    _message(db_session, cid, uid, 1)
    broken = _message(db_session, cid, uid, 2)
    broken.body = b"invalid encrypted body"
    db_session.commit()
    client.raise_server_exceptions = False
    response = _read(client, aid, cid)
    assert response.status_code == 500
    assert "redacted safe text" not in response.text
    assert len(_views(cid)) == 1
