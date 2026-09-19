"""Crisis scan."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.enums import SafetySignal


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
