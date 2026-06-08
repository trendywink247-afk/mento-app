"""Conversation lifecycle: end, and Panda Wipe (real server-side delete, DECISIONS §H.2)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus
from app.models.listener import ListenerProfile
from app.security import current_user_id
from app.services import stream

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _owned(db: Session, convo_id: str, user_id: str) -> Conversation:
    convo = db.get(Conversation, convo_id)
    if convo is None or convo.user_id != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    return convo


def _release_listener(db: Session, convo: Conversation) -> None:
    listener = db.get(ListenerProfile, convo.listener_id)
    if listener and listener.active_conversations > 0:
        listener.active_conversations -= 1


@router.post("/{convo_id}/end")
def end_conversation(
    convo_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> dict:
    """End the chat. Messages are NOT deleted (this matches the in-app copy)."""
    convo = _owned(db, convo_id, user_id)
    convo.status = ConversationStatus.ended
    convo.ended_at = datetime.now(timezone.utc)
    _release_listener(db, convo)
    db.commit()
    return {"status": "ended"}


@router.post("/{convo_id}/wipe")
def wipe_conversation(
    convo_id: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> dict:
    """Panda Wipe: delete messages from BOTH sides — device AND our servers (Stream)."""
    convo = _owned(db, convo_id, user_id)
    if convo.stream_channel_id:
        stream.wipe_channel(convo.stream_channel_id)
    convo.status = ConversationStatus.wiped
    convo.ended_at = datetime.now(timezone.utc)
    _release_listener(db, convo)
    db.commit()
    return {"status": "wiped", "deleted_from": ["device", "servers"]}
