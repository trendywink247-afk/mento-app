"""T3.12 — an admin may read a live conversation only while it has an OPEN case (an
unreviewed safety flag or an unresolved report on that conversation) and only with a
stated reason, which is written into the audit row. Everything else is refused
before Stream is asked for a single message."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models.admin import AdminAccount, AdminAuditLog
from app.models.conversation import Conversation
from app.models.enums import (
    AdminRole,
    ConversationStatus,
    ListenerStatus,
    ModerationLevel,
    ReporterKind,
    SafetySignal,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.moderation import ModerationEvent
from app.models.safety import SafetyFlag
from app.models.user import User
from app.security import issue_admin_token
from app.services import stream

from .conftest import TestSession, requires_postgres

REASON = "reviewing the open crisis flag"


@pytest.fixture(autouse=True)
def fetched(monkeypatch):
    calls: list[str] = []

    def _fetch(cid: str):
        calls.append(cid)
        return [
            {"id": "m1", "text": "hi", "user_persona": "Quiet Cove", "at": "2026-09-27T00:00:00Z"}
        ]

    monkeypatch.setattr(stream, "fetch_channel_messages", _fetch)
    return calls


@pytest.fixture
def client():
    return TestClient(app)


def _world(s) -> tuple[str, str, str, str]:
    admin = AdminAccount(name="Helper", role=AdminRole.helper)
    user = User(
        persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30
    )
    listener = ListenerProfile(
        persona_name="Open River",
        persona_avatar="river",
        categories=[],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=1,
        max_concurrent=3,
    )
    s.add_all([admin, user, listener])
    s.flush()
    convo = Conversation(
        type="anon",
        status=ConversationStatus.active,
        user_id=user.id,
        listener_id=listener.id,
        stream_channel_id="c-scope",
    )
    s.add(convo)
    s.flush()
    return admin.id, user.id, listener.id, convo.id


def _read(client, admin_id: str, convo_id: str, reason: str | None = REASON):
    params = {"reason": reason} if reason is not None else {}
    return client.get(
        f"/api/v1/admin/conversations/{convo_id}/messages",
        params=params,
        headers={"Authorization": f"Bearer {issue_admin_token(admin_id)}"},
    )


def _views(convo_id: str) -> list[AdminAuditLog]:
    with TestSession() as s:
        return list(
            s.scalars(
                select(AdminAuditLog).where(
                    AdminAuditLog.action == "conversation.viewed",
                    AdminAuditLog.subject_id == convo_id,
                )
            )
        )


@requires_postgres
def test_no_open_case_is_refused_and_nothing_is_fetched(client, db_session, fetched):
    admin_id, _, _, convo_id = _world(db_session)
    db_session.commit()
    r = _read(client, admin_id, convo_id)
    assert r.status_code == 403
    assert r.json()["code"] == "no_open_case"
    assert fetched == []
    assert _views(convo_id) == []


@requires_postgres
def test_a_reviewed_flag_is_not_an_open_case(client, db_session, fetched):
    admin_id, uid, _, convo_id = _world(db_session)
    db_session.add(
        SafetyFlag(user_id=uid, conversation_id=convo_id, signal=SafetySignal.abuse, reviewed=True)
    )
    db_session.commit()
    assert _read(client, admin_id, convo_id).status_code == 403
    assert fetched == []


@requires_postgres
def test_open_flag_with_reason_reads_and_audits_the_reason(client, db_session, fetched):
    admin_id, uid, _, convo_id = _world(db_session)
    db_session.add(SafetyFlag(user_id=uid, conversation_id=convo_id, signal=SafetySignal.suicidal))
    db_session.commit()
    r = _read(client, admin_id, convo_id)
    assert r.status_code == 200 and r.json()[0]["text"] == "hi"
    assert fetched == ["c-scope"]
    (row,) = _views(convo_id)
    assert row.meta["reason"] == REASON
    assert row.meta["case"] == "safety_flag"


@requires_postgres
def test_own_room_open_case_never_uses_stream_or_claims_a_successful_view(
    client, db_session, fetched
):
    admin_id, uid, _, convo_id = _world(db_session)
    db_session.get(Conversation, convo_id).chat_backend = "own"
    db_session.add(SafetyFlag(user_id=uid, conversation_id=convo_id, signal=SafetySignal.suicidal))
    db_session.commit()
    response = _read(client, admin_id, convo_id)
    assert response.status_code == 409
    assert response.json()["code"] == "moderation_transport_not_supported"
    assert fetched == []
    assert _views(convo_id) == []


@requires_postgres
def test_open_report_is_an_open_case(client, db_session, fetched):
    admin_id, uid, lid, convo_id = _world(db_session)
    db_session.add(
        ModerationEvent(
            reporter_id=uid,
            reporter_kind=ReporterKind.member,
            subject_id=lid,
            conversation_id=convo_id,
            level=ModerationLevel.warning,
            reason="harassment",
        )
    )
    db_session.commit()
    assert _read(client, admin_id, convo_id).status_code == 200
    assert _views(convo_id)[0].meta["case"] == "report"


@requires_postgres
@pytest.mark.parametrize("reason", [None, "", "   ", "look"])
def test_a_reason_is_required(client, db_session, fetched, reason):
    admin_id, uid, _, convo_id = _world(db_session)
    db_session.add(SafetyFlag(user_id=uid, conversation_id=convo_id, signal=SafetySignal.suicidal))
    db_session.commit()
    assert _read(client, admin_id, convo_id, reason).status_code == 422
    assert fetched == []
    assert _views(convo_id) == []


@requires_postgres
def test_a_flag_on_another_conversation_does_not_open_this_one(client, db_session, fetched):
    admin_id, uid, lid, convo_id = _world(db_session)
    other = Conversation(type="anon", status=ConversationStatus.ended, user_id=uid, listener_id=lid)
    db_session.add(other)
    db_session.flush()
    db_session.add(SafetyFlag(user_id=uid, conversation_id=other.id, signal=SafetySignal.suicidal))
    db_session.commit()
    assert _read(client, admin_id, convo_id).status_code == 403
