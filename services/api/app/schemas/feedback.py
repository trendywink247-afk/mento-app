"""Product feedback (board A11)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

FeedbackCategory = Literal["broken", "confusing", "idea"]


class FeedbackIn(BaseModel):
    """`screen` is the ROUTE the sheet was opened from ("(tabs)/journals",
    "chat/[id]") — a template, never a path with an id in it, never free text."""

    category: FeedbackCategory
    text: str = Field(min_length=1, max_length=1000)
    screen: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_\-/\[\]().+]+$")
    app_version: str | None = Field(default=None, max_length=32, pattern=r"^[A-Za-z0-9_\-.+ ()]+$")

    @field_validator("text")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("say a little about what happened")
        return value


class FeedbackReceived(BaseModel):
    """status "received": saved for the team. status "support": the words carried a
    crisis signal — they were NOT kept as feedback, and `crisis` holds the support line
    and helplines the sheet must show (same payload as a chat message's `crisis`)."""

    status: str
    crisis: dict | None = None


class AdminFeedbackItem(BaseModel):
    id: str
    created_at: str
    role: str
    category: str
    text: str
    screen: str | None
    app_version: str | None


class AdminFeedbackOut(BaseModel):
    total: int
    limit: int
    offset: int
    items: list[AdminFeedbackItem]
