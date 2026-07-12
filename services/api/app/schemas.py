"""Request/response models (Pydantic v2)."""
from __future__ import annotations

import json
from datetime import date
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models.enums import RequestKind, SafetySignal


# --- Onboarding ---
class OnboardingStart(BaseModel):
    dob: date
    email: EmailStr | None = None  # optional, recovery only
    companion_animal: str | None = Field(default=None, max_length=32)
    companion_colour: str | None = Field(default=None, max_length=32)


class PersonaOut(BaseModel):
    id: str
    persona_name: str
    persona_avatar: str


class OnboardingResult(BaseModel):
    session_token: str   # Mento anonymous JWT
    stream_token: str    # Stream Chat client token
    user: PersonaOut


# --- Matching ---
class MatchRequest(BaseModel):
    kind: RequestKind = RequestKind.general
    issue_category: str | None = None
    target_listener_id: str | None = None
    intro_message: str | None = Field(default=None, max_length=160)


class MatchResult(BaseModel):
    conversation_id: str
    stream_channel_id: str | None
    listener_persona_name: str
    listener_persona_avatar: str


# --- Listener discovery + personal requests ---
class ListenerOut(BaseModel):
    """Anonymous persona card — no real names/photos/star ratings in v1 (T&S #7)."""
    id: str
    persona_name: str
    persona_avatar: str
    gender: str
    categories: list[str]
    status: str
    available: bool


class PersonalRequestIn(BaseModel):
    intro_message: str = Field(min_length=1, max_length=160)
    issue_category: str | None = None


class RequestOut(BaseModel):
    id: str
    status: str
    target_listener_id: str | None
    intro_message: str | None
    conversation_id: str | None
    created_at: str


# --- Listener console (minimal, DECISIONS §I.6) ---
class ListenerMeOut(BaseModel):
    """The authenticated listener's own profile + a Stream token to join channels."""
    id: str
    persona_name: str
    persona_avatar: str
    status: str
    categories: list[str]
    active_conversations: int
    max_concurrent: int
    stream_token: str


class ListenerStatusIn(BaseModel):
    # offline stays a seed/admin state — the console only toggles presence.
    status: Literal["online", "away"]


class ListenerConversationItem(BaseModel):
    """A conversation as the listener sees it: the MEMBER's persona, never their
    identity — and none of the member's privacy controls (lock/PIN are theirs).
    ``member_masked`` surfaces only THAT the member set a Panda Mask (so the
    listener sees "away" instead of silence), never the mask text itself."""
    id: str
    status: str
    user_persona_name: str
    user_persona_avatar: str
    stream_channel_id: str | None
    member_masked: bool
    created_at: str
    ended_at: str | None


class ListenerRequestItem(BaseModel):
    id: str
    intro_message: str | None
    issue_category: str | None
    requester_persona_name: str
    created_at: str


# --- Safety ---
class ScanRequest(BaseModel):
    # Stream's max message length is 5000 — nothing legitimate is longer, and an
    # uncapped body would run arbitrarily large text through the crisis regexes.
    text: str = Field(max_length=5000)
    conversation_id: str | None = Field(default=None, max_length=36)


class ScanResult(BaseModel):
    triggered: bool
    signal: SafetySignal
    helplines: list[dict] = []
    message: str | None = None  # support-and-refer copy when triggered


# --- Conversation options ---
class LockRequest(BaseModel):
    pin: str = Field(pattern=r"^\d{4}$")  # simplified v1 lock: 4 digits


class UnlockRequest(BaseModel):
    pin: str = Field(pattern=r"^\d{4}$")


class StatusMaskRequest(BaseModel):
    mask: str | None = Field(default=None, max_length=32)  # "Panda Mask"; null clears


class PauseRequest(BaseModel):
    paused: bool  # "Panda Pause" — mute notifications


class ReportRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class ConversationListItem(BaseModel):
    """Row for My Chats (#54/55). Message previews come from Stream client-side."""
    id: str
    status: str
    listener_persona_name: str
    listener_persona_avatar: str
    stream_channel_id: str | None
    is_locked: bool
    created_at: str
    ended_at: str | None


class VerifyPinRequest(BaseModel):
    pin: str = Field(pattern=r"^\d{4}$")


class ConversationState(BaseModel):
    """Echoed back so the client can reflect the options sheet without guessing."""
    id: str
    status: str
    is_locked: bool
    is_paused: bool
    status_mask: str | None = None


class OkResult(BaseModel):
    status: str


# --- End-of-conversation reflection ---
class ReflectionIn(BaseModel):
    energy: int = Field(ge=1, le=5)  # 1 = left drained … 5 = left energized


# --- Journals (v1: save-to-Mentor-Notes from chat) ---
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


# --- Moderation review queue (admin) ---
class ModerationItem(BaseModel):
    id: str
    reporter_id: str | None
    subject_id: str
    conversation_id: str | None
    level: int
    reason: str | None
    blocked: bool
    reviewed: bool
    created_at: str
