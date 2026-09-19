"""Shapes shared by more than one surface."""

from __future__ import annotations

from pydantic import BaseModel


class OkResult(BaseModel):
    status: str
