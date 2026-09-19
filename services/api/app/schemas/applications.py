"""Become-a-listener applications (member side) + the native console credential."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class ListenerApplicationIn(BaseModel):
    motivation: str = Field(min_length=40, max_length=500)
    communities: list[str] = Field(default_factory=list, max_length=5)
    availability: Literal["few_hours", "most_evenings", "weekends", "varies"]
    email: EmailStr | None = None  # same pattern as OnboardingStart.email
    mentor_interest: bool = False
    pledge_accepted: bool


class ListenerApplicationOut(BaseModel):
    id: str
    status: str
    mentor_interest: bool
    created_at: str
    # Present only when approved: the applicant's private console link.
    console_url: str | None = None


class ConsoleSessionOut(BaseModel):
    """Native mentor console credential (spec 2026-09-05 §3): the listener JWT for
    an approved member, plus what the console needs to connect to Stream. Issued
    only while BOTH the application and the profile are approved."""

    listener_token: str
    listener_id: str
    persona_name: str
    persona_avatar: str
    stream_token: str
    expires_at: str
