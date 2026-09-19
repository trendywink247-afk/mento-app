"""Stay in touch (DECISIONS §L.6–7) — personas only, both directions (T&S #7)."""

from __future__ import annotations

from pydantic import BaseModel


class InTouchSlots(BaseModel):
    """ "In touch · 2 of 2". A waiting ask holds a place too."""

    limit: int
    in_touch: int
    waiting: int
    free: int


class StayInTouchOut(BaseModel):
    """The member's standing with ONE mentor (keyed by one of their conversations).

    state: "none" | "asked" | "in_touch" | "not_now".
    blocked_reason (when `can_ask` is false and state is none / not_now):
      "in_touch_full" | "in_touch_waiting" | "not_now_cooldown" | "unavailable"."""

    state: str
    link_id: str | None
    can_ask: bool
    blocked_reason: str | None
    can_ask_again_at: str | None
    slots: InTouchSlots
    mentor_name: str  # the name they carry today
    first_met_as: str | None  # set once it differs from `mentor_name`
    first_met_at: str | None
    names_change_at: str  # the next 04:00 IST, as UTC — "tomorrow this mentor will…"


class InTouchItem(BaseModel):
    """A mentor the member is in touch with (or is waiting on), under the name they
    carry TODAY plus the stable "first met as" marker."""

    link_id: str
    state: str  # "in_touch" | "asked"
    listener_id: str
    persona_name: str
    persona_avatar: str
    first_met_as: str | None
    first_met_at: str
    since: str | None  # when the mentor said yes
    status: str
    available: bool
    categories: list[str]
    community_slug: str | None
    public_line: str | None
    availability_note: str | None
    # The member's most recent conversation with this mentor — open it to write.
    conversation_id: str | None
    conversation_status: str | None
    stream_channel_id: str | None


class InTouchListOut(BaseModel):
    slots: InTouchSlots
    items: list[InTouchItem]  # accepted — the In touch view
    waiting: list[InTouchItem]  # asked, not answered yet


class StayInTouchAskItem(BaseModel):
    """A waiting ask as the MENTOR sees it: the member's persona and companion, and
    the conversation it came from. Nothing else about the member exists here."""

    id: str
    member_persona_name: str
    member_persona_avatar: str
    companion_animal: str | None
    companion_colour: str | None
    conversation_id: str | None
    asked_at: str
