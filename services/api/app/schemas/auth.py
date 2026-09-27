"""Sessions and refresh tokens (T3.2)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class UpgradeIn(BaseModel):
    device_id: str | None = Field(default=None, max_length=64)


class RefreshIn(BaseModel):
    refresh_token: str = Field(max_length=256)
    device_id: str | None = Field(default=None, max_length=64)


class SessionPairOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds the access token lives
    refresh_expires_at: str
