"""Answer evaluations (DECISIONS T.8). Member and mentor shapes are separate on purpose: the
mentor's never carries anything about who sent it."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.listeners import SupportOut


class EvaluationStartIn(BaseModel):
    kind: Literal["mains", "essay"]
    audience: Literal["everyone", "one"] = "everyone"
    # With audience "one": the mentor's id from Peers.
    listener_id: str | None = Field(default=None, max_length=36)
    question: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=500)


class PageIn(BaseModel):
    # One photo (JPG or PNG) as base64, up to 3 MB before encoding.
    content_base64: str = Field(min_length=8, max_length=4_400_000)


class PageAdded(BaseModel):
    pages: int


class EvaluationOut(BaseModel):
    id: str
    kind: str
    audience: str
    # draft | open | claimed | returned | withdrawn | expired
    status: str
    question: str | None = None
    note: str | None = None
    pages: int = 0
    # False once the photos are wiped (30 days after feedback, or on withdrawal / expiry).
    pages_available: bool = True
    sent_at: str | None = None
    returned_at: str | None = None
    feedback: str | None = None
    # The persona name of the mentor it was sent to, or who took it. Never more.
    mentor_name: str | None = None
    support: SupportOut | None = None


class MentorEvaluationOut(BaseModel):
    id: str
    kind: str
    # True when the member chose this mentor by name.
    personal: bool
    # open | claimed | returned
    status: str
    question: str | None = None
    note: str | None = None
    pages: int = 0
    pages_available: bool = True
    sent_at: str | None = None
    # When a claimed answer goes back to everyone if not returned.
    due_at: str | None = None
    feedback: str | None = None
    # What returning it pays now, or what it would have paid (a record; nothing is paid yet).
    payout_paise: int = 0


class FeedbackIn(BaseModel):
    feedback: str = Field(min_length=1, max_length=4000)
