"""Member-facing mentor discovery, profiles and Personal requests."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ListenerOut(BaseModel):
    """Anonymous persona card — no real names/photos/star ratings in v1 (T&S #7)."""

    id: str
    persona_name: str
    persona_avatar: str
    gender: str
    categories: list[str]
    status: str
    available: bool
    is_favourite: bool


class ListenerProfileOut(BaseModel):
    """The member-side mentor profile, "Two in the room" (spec 2026-09-06 §3.3).
    Keyed by conversation (`GET /conversations/{id}/mentor`) or by listener id
    (`GET /listeners/{id}`, Browse). Anonymous persona only — T&S #7."""

    id: str
    persona_name: str
    persona_avatar: str
    gender: str
    categories: list[str]
    community_slug: str | None
    status: str
    available: bool
    public_line: str | None
    availability_note: str | None
    listening_since: str  # ISO date of ListenerProfile.created_at
    conversations_held: int
    is_favourite: bool


class ConversationMentorOut(ListenerProfileOut):
    """`GET /conversations/{id}/mentor` — the mentor's profile PLUS the member's own
    topic for THIS conversation (the chat header's topic chip). The topic is the
    member's own match-time choice; nothing here says anything new about either
    person to the other side (T&S #7). Historic rows: both null."""

    issue_category: str | None = None
    issue_category_label: str | None = None


class PersonalRequestIn(BaseModel):
    intro_message: str = Field(min_length=1, max_length=160)
    issue_category: str | None = Field(default=None, max_length=40)


class RequestOut(BaseModel):
    id: str
    status: str
    target_listener_id: str | None
    intro_message: str | None
    conversation_id: str | None
    created_at: str
