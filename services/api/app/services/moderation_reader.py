"""Fetch-and-forget own-chat view, called only after the admin case gate and audit.

Same latest-100 window as Stream. Read only surviving encrypted live rows: never
restore deleted/expired content, reconstruct pre-redaction originals, or copy bodies
into the case/audit store. Returns only stored delivery text, which can contain
original text when the send pipeline's existing redaction policy fails open.
This is not a participant authorization bypass endpoint.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.chat_message import ChatMessage
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.services import message_crypto


def own_messages(db: Session, convo: Conversation) -> list[dict]:
    if convo.chat_backend != "own":
        raise ValueError("own reader requires stored own transport")
    if convo.status == ConversationStatus.wiped:
        return []
    rows = list(
        db.scalars(
            select(ChatMessage)
            .where(ChatMessage.conversation_id == convo.id)
            .order_by(ChatMessage.seq.desc())
            .limit(100)
        )
    )
    member = db.get(User, convo.user_id)
    mentor = db.get(ListenerProfile, convo.listener_id)
    personas = {
        ("member", convo.user_id): member.persona_name if member else "Member",
        ("mentor", convo.listener_id): mentor.persona_name if mentor else "Mentor",
    }
    out = []
    for message in reversed(rows):
        # A malformed sender must not label another account's body as a participant.
        persona = personas.get((message.sender_kind, message.sender_id))
        if persona is None:
            raise ValueError("message sender is not a conversation participant")
        out.append(
            {
                "id": message.id,
                "text": message_crypto.decrypt(
                    message.body, message.key_id, message_id=message.id, conversation_id=convo.id
                ),
                "user_persona": persona,
                "at": message.created_at.isoformat(),
            }
        )
    return out
