"""Become-a-listener applications (member side) + the native console credential."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, EmailStr, Field

AvailableTime = Literal["mornings", "afternoons", "evenings", "late_nights", "weekends"]


class ListenerApplicationIn(BaseModel):
    motivation: str = Field(min_length=40, max_length=500)
    communities: list[str] = Field(default_factory=list, max_length=5)
    availability: Literal["few_hours", "most_evenings", "weekends", "varies"]
    # Board A37's time-of-day chips (DECISIONS §L, founder-delegated 2026-09-19),
    # additive beside the commitment above. Optional so older builds still submit;
    # the current app requires at least one chip before it sends. Order-free and
    # de-duplicated on the way in.
    available_times: list[AvailableTime] | None = Field(default=None, max_length=5)
    email: EmailStr | None = None  # same pattern as OnboardingStart.email
    mentor_interest: bool = False
    pledge_accepted: bool


class ListenerApplicationOut(BaseModel):
    id: str
    status: str
    mentor_interest: bool
    created_at: str
    # Always null since T3.10 (the poll no longer mints a console token); kept so
    # older builds parse. Ask POST /listener-applications/me/console-code instead.
    console_url: str | None = None
    # True while the application is approved AND the mentor profile is live — the
    # signal older builds read from `console_url` (Start fresh's mentor check).
    console_active: bool = False
    # Declined only: when the server's 30-day cooldown lets them apply again (ISO time).
    # Additive; older builds ignore it.
    reapply_after: str | None = None
    # Approved only: when this mentor asked the team to step their mentor side back
    # (POST /listener-applications/me/step-back). Additive; null otherwise.
    step_back_requested_at: str | None = None


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


class StepBackIn(BaseModel):
    """A live mentor asks the team to step their mentor side back (board A32 / 409).
    The reason is optional and bounded; only the admin Listeners panel ever shows it."""

    reason: str | None = Field(default=None, max_length=280)


class StepBackOut(BaseModel):
    status: Literal["requested"] = "requested"
    requested_at: str


class ConsoleCodeOut(BaseModel):
    """A one-time console code (T3.10): 10 minutes, single use."""

    code: str
    console_url: str
    expires_at: str


class ConsoleExchangeIn(BaseModel):
    code: str = Field(max_length=128)


class ConsoleExchangeOut(BaseModel):
    listener_token: str
    listener_id: str
    expires_at: str
