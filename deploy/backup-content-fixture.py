"""Synthetic content fixtures, only for the network-isolated recovery drill."""
import sys
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.engine import make_url

from app.config import get_settings
from app.db import SessionLocal
from app.models.chat_message import ChatMessage
from app.models.conversation import Conversation
from app.models.enums import JournalChannel
from app.models.journal import JournalEntry
from app.models.listener import ListenerProfile
from app.models.moderation import ModerationEvent
from app.models.user import User
from app.models.erasure_receipt import ErasureReceipt
from app.services.erasure import recovery_digest
from app.services.recovery_reconciliation import reconcile_restored_members

settings = get_settings()
url = make_url(settings.database_url)
if not (settings.is_dev and url.username == "drill" and url.host == "127.0.0.1"
        and url.database in {"source", "recovered"}):
    raise SystemExit("Refusing non-drill database")

with SessionLocal() as db:
    if sys.argv[1] == "seed":
        member = User(persona_name="Synthetic member", persona_avatar="fixture",
                      dob=date(2000, 1, 1), age_at_signup=26)
        mentor = ListenerProfile(persona_name="Synthetic mentor", persona_avatar="fixture")
        db.add_all([member, mentor])
        db.flush()
        conversation = Conversation(user_id=member.id, listener_id=mentor.id)
        db.add(conversation)
        db.flush()
        db.add(ChatMessage(conversation_id=conversation.id, sender_kind="member",
                           sender_id=member.id, seq=1, client_id="fixture-message",
                           body=b"synthetic chat bytes", key_id="fixture"))
        db.add(JournalEntry(user_id=member.id, channel=JournalChannel.mentor_notes,
                            body="retained synthetic note", source="chat",
                            meta={"conversation_id": conversation.id}))
        db.add(ModerationEvent(reporter_id=member.id, subject_id=mentor.id,
                               conversation_id=conversation.id,
                               reason="retained synthetic report", blocked=True))
        db.commit()
        assert db.scalar(select(func.count()).select_from(ChatMessage)) == 1
    elif sys.argv[1] == "verify":
        assert db.scalar(select(func.count()).select_from(ChatMessage)) == 0
        note = db.scalars(select(JournalEntry)).one()
        report = db.scalars(select(ModerationEvent)).one()
        assert note.body == "retained synthetic note" and note.source == "chat"
        assert report.reason == "retained synthetic report" and report.blocked
        assert db.get(User, note.user_id) is not None
        assert db.get(Conversation, report.conversation_id) is not None
        print("PASS: chat rows excluded; saved note, report and block state retained")
    elif sys.argv[1] == "erase-source":
        assert url.database == "source"
        member = db.scalars(select(User)).one()
        digest = recovery_digest(member.id)
        assert reconcile_restored_members(db, {digest}) == 1
        db.commit()
        assert db.get(ErasureReceipt, digest) is not None
        # Synthetic digest only: emulate receipt arriving after the snapshot.
        print(digest)
    elif sys.argv[1] == "reconcile":
        assert url.database == "recovered"
        digest = sys.argv[2]
        assert db.get(ErasureReceipt, digest) is None  # snapshot predates deletion
        assert reconcile_restored_members(db, {digest}) == 1
        db.commit()
        assert db.scalar(select(func.count()).select_from(User)) == 0
        assert db.scalar(select(func.count()).select_from(JournalEntry)) == 0
        assert db.scalar(select(func.count()).select_from(Conversation)) == 0
        report = db.scalars(select(ModerationEvent)).one()
        assert report.reporter_id is None
        assert report.reason == "retained synthetic report" and report.blocked
        assert db.get(ErasureReceipt, digest) is not None
        assert reconcile_restored_members(db, {digest}) == 0
        print("PASS: post-snapshot erasure replay removes restored account/notes and detaches report")
    else:
        raise SystemExit("Unknown drill mode")
