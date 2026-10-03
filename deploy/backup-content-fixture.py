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
    else:
        raise SystemExit("Expected seed or verify")
