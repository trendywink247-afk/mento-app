"""Synthetic stale-snapshot replay with an independently retained receipt witness.

Runs on the isolated test database only. This logical restoration drill is not a
production pg_restore, primary-host loss proof, or historical-coverage acceptance.
"""

from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import select

from app.models.conversation import Conversation
from app.models.enums import JournalChannel
from app.models.journal import JournalEntry
from app.models.listener import ListenerProfile
from app.models.session import Session as AuthSession
from app.models.user import User
from app.services import chat_events, recovery_receipts, sessions, stream
from app.services.erasure import erase_member, recovery_digest
from app.services.recovery_reconciliation import reconcile_restored_export

from .chat_helpers import seed_chat
from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


def snapshot_row(row):
    return {column.name: getattr(row, column.name) for column in row.__table__.columns}


def test_independent_receipts_remove_resurrected_notes_and_credentials(
    db_session, monkeypatch, tmp_path
):
    root = Path(__file__).resolve().parents[3]
    monkeypatch.syspath_prepend(str(root / "services"))
    monkeypatch.syspath_prepend(str(root / "scripts"))
    from recovery_receipt_evidence import checkpoint, trusted_checkpoint, verify
    from recovery_receiver.store import Store, canonical, initialize

    database = tmp_path / "independent-receiver.sqlite3"
    initialize(database)
    receiver = Store(database)
    export_path = tmp_path / "received-export.json"
    witness_path = tmp_path / "retained-checkpoint.json"
    monkeypatch.setattr(recovery_receipts, "acknowledge", receiver.record)
    monkeypatch.setattr(stream, "delete_user", lambda member_id: None)

    with TestSession() as db:
        room = seed_chat(db)
        note = JournalEntry(
            user_id=room.member_id,
            channel=JournalChannel.mentor_notes,
            body="synthetic saved note",
            source="chat",
        )
        retained = User(
            persona_name="Retained synthetic",
            persona_avatar="x",
            dob=date(1996, 1, 1),
            age_at_signup=30,
        )
        db.add_all([note, retained])
        db.flush()
        retained_id = retained.id
        old_pair = sessions.start(db, room.member_id)
        db.commit()
        old_member = snapshot_row(db.get(User, room.member_id))
        old_room = snapshot_row(db.get(Conversation, room.cid))
        old_note = snapshot_row(note)
        old_session = snapshot_row(
            db.scalar(select(AuthSession).where(AuthSession.user_id == room.member_id))
        )
        assert erase_member(db, room.member_id) is not None
        assert db.get(User, room.member_id) is None

    # Operator-authenticated retrieval is represented here by this synthetic
    # receiver we control; the witness/hash is held independently of the snapshot.
    export_path.write_bytes(canonical(receiver.export()))
    trusted_hash = checkpoint(export_path, witness_path)
    assert verify(export_path, witness_path, trusted_hash) == frozenset(
        {recovery_digest(room.member_id)}
    )

    # Recreate exactly the pre-erasure account, saved note, room and refresh row,
    # as a stale snapshot would. No chat body restoration or serving is performed.
    with TestSession() as db:
        db.add(User(**old_member))
        db.flush()
        db.add(Conversation(**old_room))
        db.flush()
        db.add_all([JournalEntry(**old_note), AuthSession(**old_session)])
        db.get(ListenerProfile, room.mentor_id).active_conversations = 1
        db.commit()
        assert db.get(JournalEntry, old_note["id"]) is not None
        assert db.get(AuthSession, old_session["id"]) is not None

    def forbidden(*args, **kwargs):
        raise AssertionError("Offline reconciliation must not contact serving integrations")

    monkeypatch.setattr(stream, "delete_user", forbidden)
    monkeypatch.setattr(stream, "erase_channel", forbidden)
    monkeypatch.setattr(chat_events, "after_commit", forbidden)
    monkeypatch.setattr(recovery_receipts, "acknowledge", forbidden)
    witness = trusted_checkpoint(witness_path, trusted_hash)
    with TestSession() as db:
        assert reconcile_restored_export(db, export_path.read_bytes(), witness) == 1
        db.commit()
    with TestSession() as db:
        assert db.get(User, room.member_id) is None
        assert db.get(JournalEntry, old_note["id"]) is None
        assert db.get(AuthSession, old_session["id"]) is None
        assert db.get(Conversation, room.cid) is None
        assert db.get(User, retained_id) is not None
        assert db.get(ListenerProfile, room.mentor_id).active_conversations == 0
        assert reconcile_restored_export(db, export_path.read_bytes(), witness) == 0
        with pytest.raises(sessions.SessionInvalid):
            sessions.rotate(db, old_pair.refresh_token)
