"""Email confirmation (DECISIONS R.10)."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class EmailStartIn(BaseModel):
    email: EmailStr = Field(max_length=255)


class EmailConfirmIn(BaseModel):
    code: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class EmailStatusOut(BaseModel):
    has_email: bool
    verified: bool
    # The switch (app config) is on and a real email provider is set up.
    required: bool
