"""New-chat routing (General match)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.models.enums import RequestKind


class MatchRequest(BaseModel):
    kind: RequestKind = RequestKind.general
    issue_category: str | None = Field(default=None, max_length=40)
    target_listener_id: str | None = None
    intro_message: str | None = Field(default=None, max_length=160)


class MatchResult(BaseModel):
    conversation_id: str
    stream_channel_id: str | None
    listener_persona_name: str
    listener_persona_avatar: str
    # The mentor's face (services/mentor_face.py) — the connecting orb's "found" mentor.
    listener_companion_animal: str = "Owl"
    listener_companion_colour: str = "sage"


class MatchAsk(BaseModel):
    """Ask the best available mentor for an exam niche; they accept before any chat opens."""

    issue_category: str | None = Field(default=None, max_length=40)
    intro_message: str | None = Field(default=None, max_length=160)
    # Who may take it: any approved mentor (the default), Mento Verified ("in_service") or the other
    # approved mentors ("peer"). Additive: older builds send none and get "any".
    audience: Literal["any", "in_service", "peer"] = "any"
