"""Journals: Mentor Notes, manual entries, opt-in note-sorting."""

from __future__ import annotations

import json

from pydantic import BaseModel, Field, field_validator


class MentorNoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None
    listener_persona: str | None = Field(default=None, max_length=64)
    stream_message_id: str | None = None  # idempotency key for repeated saves


class JournalEntryIn(BaseModel):
    channel: str  # mood | finance | gratitude (mentor_notes has its own endpoint)
    body: str = Field(min_length=1, max_length=4000)
    meta: dict = {}

    @field_validator("meta")
    @classmethod
    def _meta_size(cls, v: dict) -> dict:
        # meta is client-shaped (mood value, amounts, tags) — small by design.
        if len(json.dumps(v)) > 2048:
            raise ValueError("meta too large")
        return v


class JournalEntryOut(BaseModel):
    id: str
    channel: str
    body: str
    source: str
    meta: dict
    created_at: str


# Opt-in AI note-sorting. Only the user's own reflective channels — never mentor_notes.
class OrganizeIn(BaseModel):
    channel: str  # mood | finance | gratitude


class OrganizeTheme(BaseModel):
    title: str
    summary: str
    count: int


class OrganizeOut(BaseModel):
    overview: str
    themes: list[OrganizeTheme]
    entry_count: int
