"""Push-notification device registration."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class PushTokenIn(BaseModel):
    expo_push_token: str = Field(min_length=1, max_length=255)
    platform: Literal["ios", "android"]


class PushTokenDeleteIn(BaseModel):
    expo_push_token: str = Field(min_length=1, max_length=255)
