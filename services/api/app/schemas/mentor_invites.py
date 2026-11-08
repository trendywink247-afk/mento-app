"""Gold mentor invitations (DECISIONS section P.2-3)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AdminInviteCreateIn(BaseModel):
    # An admin's private reminder of who it is for. Do not put a real name or contact here.
    note: str | None = Field(default=None, max_length=80)


class AdminInviteItem(BaseModel):
    id: str
    note: str | None
    status: str  # open | claimed | revoked | expired
    created_at: str
    expires_at: str
    claimed_at: str | None


class AdminInviteCreated(AdminInviteItem):
    # Shown once. Only its hash is kept.
    code: str


class InviteClaimIn(BaseModel):
    code: str = Field(min_length=4, max_length=64)
    pledge_accepted: bool = False
