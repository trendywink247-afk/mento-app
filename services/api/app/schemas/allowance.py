"""Message allowance (DECISIONS §L.2) — the member's own state, and admin counts."""

from __future__ import annotations

from pydantic import BaseModel


class AllowanceOut(BaseModel):
    """The member's allowance right now. `GET /conversations/{id}/allowance` fills
    every field; `GET /me/allowance` (no conversation yet) reports `in_a_row` as 0.

    `held_reason` is what the NEXT send would be held for: null (send away),
    "in_a_row" (wait for the mentor) or "daily" (wait for `resets_at`). It is always
    null while holding is switched off (`enforced` false) and in a conversation the
    crisis scan has recently flagged — urgent words are never held back or counted."""

    in_a_row: int
    in_a_row_limit: int
    sent_today: int
    daily_limit: int
    left_today: int
    resets_at: str  # ISO 8601, UTC — the next 00:00 IST
    can_send: bool
    held_reason: str | None
    enforced: bool


class AdminAllowanceDay(BaseModel):
    day: str  # ISO date, IST calendar day
    messages_sent: int
    crisis_exempt_sends: int
    in_a_row_pauses: int
    members_paused_in_a_row: int
    daily_cap_holds: int
    members_reached_daily_cap: int


class AdminAllowanceRule(BaseModel):
    in_a_row: int
    per_day: int
    enforced: bool
    crisis_exempt_hours: int
    timezone: str


class AdminAllowanceOut(BaseModel):
    """Numbers only — never text, names or who (T&S #10). `days` is oldest first and
    zero-filled; `totals` sums the window (its two `members_*` fields sum per-day
    member counts — a member who paused on two days counts twice)."""

    rule: AdminAllowanceRule
    days: list[AdminAllowanceDay]
    totals: AdminAllowanceDay
