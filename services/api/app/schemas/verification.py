"""Mento Verified by document (services/verification.py)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class VerificationIn(BaseModel):
    kind: Literal[
        "id_card", "posting_letter", "mains_admit_card", "interview_letter", "result", "other"
    ]
    # The file as base64: a JPG or PNG photo, or a PDF, up to 3 MB before encoding.
    content_base64: str = Field(min_length=8, max_length=4_400_000)


class VerificationOut(BaseModel):
    id: str
    kind: str
    status: str  # pending | approved | rejected | expired
    created_at: str
    decided_at: str | None = None
    # Why, when it was not approved. Written by the team; never the document's own words.
    note: str | None = None


class AdminVerificationItem(BaseModel):
    id: str
    listener_id: str
    persona_name: str
    kind: str
    content_type: str
    size_bytes: int
    status: str
    created_at: str
    decided_at: str | None = None
    # False once the file has been wiped.
    has_file: bool = True


class VerificationDecisionIn(BaseModel):
    note: str | None = Field(default=None, max_length=200)
