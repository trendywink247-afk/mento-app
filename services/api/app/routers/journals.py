"""Journals — v1 ships the save-to-Mentor-Notes loop from chat (SCOPE §7).

The talk→action core: a user long-presses a mentor message and keeps it. Entries
belong to the anonymous user only; the body is the message text the user chose to
keep (their own data), with the conversation/message ids tucked into meta for
dedupe — never analytics.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.enums import JournalChannel
from app.models.journal import JournalEntry
from app.schemas import (
    JournalEntryIn,
    JournalEntryOut,
    MentorNoteIn,
    OrganizeIn,
    OrganizeOut,
    OrganizeTheme,
)
from app.security import current_user_id
from app.services import notes_ai

router = APIRouter(prefix="/journals", tags=["journals"])

# Only the user's OWN reflective channels may be sent to the note-sorting AI —
# never mentor_notes (the other party's words), never chat content (T&S #6/#7).
_ORGANIZABLE = {JournalChannel.mood, JournalChannel.finance, JournalChannel.gratitude}


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
        # Dedupe in SQL — loading every note into Python scaled with the user's
        # whole archive on each save of the core talk→action loop.
        existing = db.scalars(
            select(JournalEntry)
            .where(
                JournalEntry.user_id == user_id,
                JournalEntry.channel == JournalChannel.mentor_notes,
                JournalEntry.meta["stream_message_id"].as_string()
                == payload.stream_message_id,
            )
            .limit(1)
        ).first()
        if existing is not None:
            return _out(existing)

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
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[JournalEntryOut]:
    try:
        ch = JournalChannel(channel)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown journal channel")
    entries = db.scalars(
        select(JournalEntry)
        .where(JournalEntry.user_id == user_id, JournalEntry.channel == ch)
        .order_by(JournalEntry.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [_out(e) for e in entries]


@router.post("/organize", response_model=OrganizeOut)
def organize_notes(
    payload: OrganizeIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> OrganizeOut:
    """Opt-in AI: group the user's OWN entries in one reflective channel into themes.

    Dark until a Gemini key is set (503). Restricted to mood/finance/gratitude —
    mentor_notes and any chat content are never sent to the model (T&S #6/#7).
    """
    if not notes_ai.is_enabled():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "note-sorting AI is not enabled")
    try:
        ch = JournalChannel(payload.channel)
    except ValueError:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "unknown journal channel")
    if ch not in _ORGANIZABLE:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "only your own mood/finance/gratitude entries can be organized",
        )
    bodies = db.scalars(
        select(JournalEntry.body)
        .where(JournalEntry.user_id == user_id, JournalEntry.channel == ch)
        .order_by(JournalEntry.created_at.desc())
        .limit(100)
    ).all()
    if len(bodies) < 2:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "need at least a couple of entries to organize"
        )
    try:
        result = notes_ai.organize(list(bodies))
    except notes_ai.NotesAiDisabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "note-sorting AI is not enabled")
    except Exception:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "the note-sorting AI could not respond")
    return OrganizeOut(
        overview=result.overview,
        themes=[OrganizeTheme(title=t.title, summary=t.summary, count=t.count) for t in result.themes],
        entry_count=len(bodies),
    )


@router.get("/mentor-notes", response_model=list[JournalEntryOut])
def list_mentor_notes(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
    limit: int = Query(100, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[JournalEntryOut]:
    """Newest-first Mentor Notes for the journals surface."""
    entries = db.scalars(
        select(JournalEntry)
        .where(
            JournalEntry.user_id == user_id,
            JournalEntry.channel == JournalChannel.mentor_notes,
        )
        .order_by(JournalEntry.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    return [_out(e) for e in entries]
