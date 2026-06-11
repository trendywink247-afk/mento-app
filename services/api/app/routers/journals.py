"""Journals — v1 ships the save-to-Mentor-Notes loop from chat (SCOPE §7).

The talk→action core: a user long-presses a mentor message and keeps it. Entries
belong to the anonymous user only; the body is the message text the user chose to
keep (their own data), with the conversation/message ids tucked into meta for
dedupe — never analytics.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.enums import JournalChannel
from app.models.journal import JournalEntry
from app.schemas import JournalEntryIn, JournalEntryOut, MentorNoteIn
from app.security import current_user_id

router = APIRouter(prefix="/journals", tags=["journals"])


def _out(e: JournalEntry) -> JournalEntryOut:
    return JournalEntryOut(
        id=e.id,
        channel=e.channel.value,
        body=e.body,
        source=e.source,
        meta=e.meta or {},
        created_at=e.created_at.isoformat(),
    )


@router.post("/mentor-notes", response_model=JournalEntryOut)
def save_mentor_note(
    payload: MentorNoteIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    """Save a mentor message to the user's Mentor Notes. Saving the same Stream
    message twice returns the existing note (idempotent long-press)."""
    if payload.stream_message_id:
        existing = db.scalars(
            select(JournalEntry).where(
                JournalEntry.user_id == user_id,
                JournalEntry.channel == JournalChannel.mentor_notes,
            )
        ).all()
        for e in existing:
            if (e.meta or {}).get("stream_message_id") == payload.stream_message_id:
                return _out(e)

    entry = JournalEntry(
        user_id=user_id,
        channel=JournalChannel.mentor_notes,
        body=payload.body,
        source="chat",
        meta={
            "conversation_id": payload.conversation_id,
            "listener_persona": payload.listener_persona,
            "stream_message_id": payload.stream_message_id,
        },
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _out(entry)


@router.get("/summary", response_model=dict)
def journals_summary(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> dict:
    """Entry counts per channel — the hub's badges."""
    rows = db.execute(
        select(JournalEntry.channel, func.count())
        .where(JournalEntry.user_id == user_id)
        .group_by(JournalEntry.channel)
    ).all()
    return {channel.value: count for channel, count in rows}


@router.post("/entries", response_model=JournalEntryOut)
def create_entry(
    payload: JournalEntryIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> JournalEntryOut:
    """Manual journal entry (mood / finance / gratitude). Mentor Notes go through
    their own idempotent endpoint."""
    if payload.channel == JournalChannel.mentor_notes.value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "use /journals/mentor-notes")
    try:
        channel = JournalChannel(payload.channel)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown journal channel")

    entry = JournalEntry(
        user_id=user_id,
        channel=channel,
        body=payload.body,
        source="manual",
        meta=payload.meta or {},
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return _out(entry)


@router.get("/entries", response_model=list[JournalEntryOut])
def list_entries(
    channel: str,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> list[JournalEntryOut]:
    try:
        ch = JournalChannel(channel)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown journal channel")
    entries = db.scalars(
        select(JournalEntry)
        .where(JournalEntry.user_id == user_id, JournalEntry.channel == ch)
        .order_by(JournalEntry.created_at.desc())
    ).all()
    return [_out(e) for e in entries]


@router.get("/mentor-notes", response_model=list[JournalEntryOut])
def list_mentor_notes(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> list[JournalEntryOut]:
    """Newest-first Mentor Notes for the journals surface."""
    entries = db.scalars(
        select(JournalEntry)
        .where(
            JournalEntry.user_id == user_id,
            JournalEntry.channel == JournalChannel.mentor_notes,
        )
        .order_by(JournalEntry.created_at.desc())
    ).all()
    return [_out(e) for e in entries]
