"""Request/response models (Pydantic v2)."""
from __future__ import annotations

from datetime import date

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import RequestKind, SafetySignal


# --- Onboarding ---
class OnboardingStart(BaseModel):
    dob: date
    email: EmailStr | None = None  # optional, recovery only
    companion_animal: str | None = None
    companion_colour: str | None = None


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


# --- Safety ---
class ScanRequest(BaseModel):
    text: str
    conversation_id: str | None = None


class ScanResult(BaseModel):
    triggered: bool
    signal: SafetySignal
    helplines: list[dict] = []
    message: str | None = None  # support-and-refer copy when triggered
